/**
 * 粒子虹膜渲染器 V2（three.js · Points + 四层附加结构）
 *
 * 结构（4 个 draw call + 粒子）：
 *   haze     —— 加法混合的径向雾光，把散点"粘"成一个体
 *   points   —— 虹膜条纹 / 瞳孔环 / 外圈刻度 / 尘埃
 *   limbus   —— 暗色角膜缘（法线混合，遮住粒子 → 真正的边界）
 *   pupil    —— 深色瞳孔实体（可平移、可扩张）
 *   catch    —— 角膜高光（加法混合）
 *
 * 空间约定（P0 修复的核心）：
 *   指针先换算到 **对象空间**（减去 points.position），再写进 uPointer；
 *   着色器里的 p 就是对象空间，两者同空间比较，不再有 0.12 的纵向偏移。
 *
 * 凝视（P0）：
 *   follow / wander / return 三态 + saccade（眼跳）与 fixation（凝视停留）。
 *   眼跳时长按 D = 20 + 2·A(deg) 计算，下限 90ms。
 *
 * 主题（P1）：
 *   昼夜共用同一份几何；切换只改 uniform 与 material.blending（需要 needsUpdate），
 *   不重建 geometry / renderer，也不重置凝视状态。
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  NormalBlending,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type Tier = 'high' | 'mid' | 'low';
export type IrisTheme = 'night' | 'day';

export interface IrisHandle {
  dispose: () => void;
  setTheme: (theme: IrisTheme) => void;
}

const TIER_CONFIG: Record<Tier, { count: number; dprCap: number }> = {
  high: { count: 34000, dprCap: 1.75 },
  mid: { count: 11000, dprCap: 1.4 },
  low: { count: 4500, dprCap: 1.35 },
};

const HALF_HEIGHT = 1.32;

/** 所有可调参数集中在这里，便于调参 */
export const IRIS_PARAMS = {
  maxGaze: 0.26, // 瞳孔最大位移（世界单位，R=1）
  gazeFollow: 0.965, // 角膜缘相对瞳孔的比例
  gazeIris: 0.94, // 条纹相对瞳孔的比例
  gazeHaze: 0.9,
  gazeDust: 0.35,
  lambdaFollow: 12, // 追踪阻尼
  lambdaSaccade: 32, // 眼跳阻尼
  lambdaReturn: 6,
  idleMs: 1400,
  fixMinMs: 800,
  fixMaxMs: 2000,
  fixLongChance: 0.12,
  fixLongMs: 2800,
  saccadeFloorMs: 90,
  saccadeMaxMs: 320,
  wanderRadiusMin: 0.35,
  wanderRadiusMax: 1.0,
  deadbandDeg: 1.6,
  microDriftDeg: 0.55,
  repelRadius: 0.42,
  repelStrength: 1.0,
  pupilRadius: 0.185,
  limbusInner: 0.972,
  limbusOuter: 1.02,
  catchOffset: { x: -0.15, y: 0.15 },
  catchRadius: 0.045,
};

/* ------------------------------------------------------------------ shaders */

const POINTS_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uDilate;
  uniform float uProgress;
  uniform float uPointerStrength;
  uniform vec2  uGaze;
  uniform vec2  uPupilCenter;
  uniform float uPupilRadius;
  uniform vec2  uPointer;
  uniform float uMaxGaze;
  uniform float uIrisHeat;   // 0..1：夜=0.55，昼=0.25（噪声对比强度）
  uniform float uSizeScale;  // 昼间把点缩小，读成更细的"针刻"
  uniform float uHatch;      // 1 = 昼间针刻（径向短线），0 = 夜间圆点

  attribute float aSeed;
  attribute float aRing;
  attribute float aSize;

  varying float vAlpha;
  varying float vRadius;
  varying float vSeed;
  varying float vFiber;
  varying float vAngle;

  // 浅球面旋转：正交投影下把虹膜当作球面的一部分转动。
  // 极点（瞳孔中心）位移最大，越靠边缘位移越小 —— 这天然给出"差速"，
  // 且整块组织是刚体，不会出现"黑色小球离开原位"的残留。
  vec3 eyeRotate(vec2 p, vec2 g) {
    float r2 = min(1.0, dot(p, p));
    float z = sqrt(max(0.0, 1.0 - r2));
    vec2 gg = clamp(g, -0.45, 0.45);
    float cz = sqrt(max(0.0, 1.0 - dot(gg, gg)));
    vec3 q = vec3(p, z);
    q = vec3(q.x * cz + q.z * gg.x, q.y, -q.x * gg.x + q.z * cz);
    q = vec3(q.x, q.y * cz + q.z * gg.y, -q.y * gg.y + q.z * cz);
    return q;
  }

  // 便宜的 2D 值噪声（3 次 hash + 平滑插值）
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    return vnoise(p) * 0.65 + vnoise(p * 2.03 + 17.3) * 0.35;
  }

  void main() {
    vec3 p = position;
    float r = length(p.xy);
    float theta = atan(p.y, p.x);

    // 1) 纤维纹理：极坐标噪声 → 径向抖动 / 明暗 / 粗细
    float n = fbm(vec2(r * 5.5, theta * 2.4));
    float fiber = smoothstep(0.35, 0.85, n);

    // 2) 缓慢自转：内圈快、外圈慢；刻度几乎不动
    float speed = 0.045 + 0.13 * (1.0 - clamp(r, 0.0, 1.0));
    float swirl = speed * uTime * (0.6 + aSeed * 0.8);
    if (aRing > 2.5) { swirl *= 0.1; }
    float c = cos(swirl);
    float s = sin(swirl);
    p = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);

    // 3) 刚体球面旋转：整块虹膜一起转，刻度（aRing>2.5）留在仪器上不动
    if (aRing < 2.5) {
      vec3 q = eyeRotate(p.xy, uGaze);
      p.xy = q.xy;
      // 瞳孔是"洞"：洞心跟着瞳孔中心走，避免原位残留一圈组织
      float pd = length(p.xy - uPupilCenter);
      if (pd < uPupilRadius * 0.99) {
        vAlpha = 0.0;
        gl_PointSize = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
    }

    // 4) 瞳孔扩张（把内圈粒子向外推一点，和瞳孔盘的扩张配合）
    float band = smoothstep(0.34, 0.16, r);
    p.xy *= 1.0 + uDilate * 0.1 * band;

    // 5) 指针扰动：径向 + 切向，滑动而不是"挖洞"
    vec2 d = p.xy - uPointer;
    float dist = length(d);
    float infl = smoothstep(0.42, 0.0, dist) * uPointerStrength;
    vec2 dir = normalize(d + vec2(0.0001));
    vec2 tang = vec2(-dir.y, dir.x);
    p.xy += (dir * 0.55 + tang * 0.7) * infl * 0.045;

    // 6) 呼吸 + 纤维抖动
    p.xy *= 1.0 + 0.0045 * sin(uTime * 0.45 + aSeed * 6.2831);
    p.xy += normalize(p.xy + vec2(0.0001)) * (n - 0.5) * 0.02 * uIrisHeat;

    // 7) 滚动解构
    float jitter = sin(aSeed * 73.1) * 0.5 + 0.5;
    vec3 flow = vec3(p.x * 2.35 + (aSeed - 0.5) * 0.85, p.y * 0.2 + (jitter - 0.5) * 0.5 - 0.12, p.z * 1.4);
    p = mix(p, flow, smoothstep(0.0, 0.85, uProgress));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float sizeFactor = mix(1.0, 0.6, smoothstep(0.15, 0.9, uProgress));
    gl_PointSize = clamp(aSize * uScale * uPixelRatio * uSizeScale * sizeFactor * (0.75 + 0.6 * fiber), 1.0, 14.0 * uPixelRatio);

    vRadius = r;
    vSeed = aSeed;
    vFiber = fiber;
    vAngle = atan(p.y, p.x);

    float fadeOut = 1.0 - smoothstep(0.58, 0.98, uProgress);
    float inner = 1.0 - smoothstep(0.45, 1.25, r);
    vAlpha = fadeOut * mix(0.2, 1.0, inner) * (0.55 + 0.45 * aSeed) * (0.35 + 1.15 * fiber);
    vAlpha *= 1.0 + 0.4 * smoothstep(0.72, 0.96, r);
    if (aRing > 1.5 && aRing < 2.5) { vAlpha *= 0.4 * mix(1.0, 0.25, uHatch); }   // 尘埃
    if (uHatch > 0.5) {
      float thinning = fract(aSeed * 17.31);
      if (thinning < 0.32) { vAlpha *= 0.15; }
      else { vAlpha *= 1.35; }
    }
    if (aRing > 2.5) { vAlpha *= 0.9; }                  // 刻度
    if (aRing > 0.5 && aRing < 1.5) { vAlpha *= 0.4; }  // 瞳孔环：压暗，避免"亮甜甜圈"
  }
`;

const POINTS_FRAGMENT = /* glsl */ `
  uniform vec3  uColorCore;
  uniform vec3  uColorMid;
  uniform vec3  uColorOuter;
  uniform float uTime;
  uniform float uOpacity;

  varying float vAlpha;
  varying float vRadius;
  varying float vSeed;
  varying float vFiber;
  varying float vAngle;
  uniform float uHatch;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    // 昼间：把圆点沿径向拉长成短线（针刻/雕版），夜间保持圆点
    float ca = cos(-vAngle);
    float sa = sin(-vAngle);
    vec2 ruv = vec2(ca * uv.x - sa * uv.y, sa * uv.x + ca * uv.y);
    float band = smoothstep(0.25, 0.95, vRadius);
    float hx = mix(0.30, 0.58, band);
    float hy = mix(2.5, 1.45, band);
    ruv.x *= mix(1.0, hx, uHatch);
    ruv.y *= mix(1.0, hy, uHatch);
    float d = length(ruv);
    if (d > 0.5) { discard; }

    float sprite = smoothstep(0.5, 0.0, d);
    vec3 color = mix(uColorCore, uColorMid, smoothstep(0.14, 0.5, vRadius));
    color = mix(color, uColorOuter, smoothstep(0.62, 1.02, vRadius));
    color *= 0.85 + 0.35 * vFiber;
    float twinkle = 0.9 + 0.1 * sin(vSeed * 41.0 + uTime * 1.4);
    gl_FragColor = vec4(color, sprite * vAlpha * twinkle * uOpacity);
  }
`;

/** 圆盘 / 环 / 光斑共用的平面着色器：vUv ∈ [0,1] → 局部坐标 [-1,1] */
const MESH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HAZE_FRAGMENT = /* glsl */ `
  uniform vec3 uInner;
  uniform vec3 uOuter;
  uniform float uOpacity;
  uniform float uTime;
  uniform vec2 uGaze;
  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1,0)), u.x),
               mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), u.x), u.y);
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    // 凝视让雾气轻微偏移，形成"眼球在动"的体积感
    p -= uGaze * 0.12;
    float r = length(p);
    float body = smoothstep(1.08, 0.12, r);
    float cloud = vnoise(p * 3.1 + vec2(uTime * 0.02, 0.0)) * 0.5 + 0.5;
    float a = pow(body, 2.2) * (0.55 + 0.45 * cloud) * uOpacity;
    vec3 col = mix(uInner, uOuter, smoothstep(0.1, 0.9, r));
    gl_FragColor = vec4(col, a);
  }
`;

const LIMBUS_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uInner;
  uniform float uOuter;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float ring = smoothstep(uInner - 0.06, uInner, r) * (1.0 - smoothstep(uOuter - 0.02, uOuter, r));
    if (ring <= 0.001) discard;
    gl_FragColor = vec4(uColor, ring * uOpacity);
  }
`;

const PUPIL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uEdge;
  uniform float uRadius;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p) / max(0.0001, uRadius);
    if (r > 1.0) discard;

    // 外缘极窄的过渡：贴住角膜缘领圈，不再有"玻璃珠"亮边
    float disc = 1.0 - smoothstep(0.965, 1.0, r);

    // 内陷：中心最深，靠近边缘略微抬起并带一点上缘阴影
    float depth = smoothstep(1.0, 0.15, r);          // 1=中心
    float topShadow = smoothstep(-0.2, 0.9, p.y);     // 上缘更暗 → 像凹进去
    vec3 col = mix(uEdge, uColor, depth);
    col *= 1.0 - 0.22 * topShadow * (1.0 - depth);

    gl_FragColor = vec4(col, disc * uOpacity);
  }
`;

const CATCH_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float glow = pow(1.0 - r, 2.6);
    gl_FragColor = vec4(uColor, glow * uOpacity);
  }
`;

/* ------------------------------------------------------------------ helpers */

function random(seed: { value: number }): number {
  seed.value = (seed.value * 1664525 + 1013904223) % 4294967296;
  return seed.value / 4294967296;
}

function buildGeometry(count: number): BufferGeometry {
  const seed = { value: 20261103 };
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const rings = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const roll = random(seed);
    let ring: number;
    let x = 0;
    let y = 0;
    let z = 0;
    let size = 0.006;

    if (roll < 0.72) {
      // 虹膜条纹：角度吸附到 320 条纤维，半径向内密集
      ring = 0;
      const radius = 0.208 + 0.73 * Math.pow(random(seed), 1.32);
      const fiber = Math.floor(random(seed) * 320);
      const angle = (fiber / 320) * Math.PI * 2 + (random(seed) - 0.5) * 0.018;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;
      z = (random(seed) - 0.5) * 0.04;
      size = 0.0055 + random(seed) * 0.006;
    } else if (roll < 0.86) {
      // 瞳孔环：一圈更密的粒子，压在瞳孔盘边缘
      ring = 1;
      const radius = 0.19 + random(seed) * 0.038;
      const angle = random(seed) * Math.PI * 2;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;
      z = (random(seed) - 0.5) * 0.01;
      size = 0.005 + random(seed) * 0.004;
    } else if (roll < 0.94) {
      // 外圈刻度
      ring = 3;
      const index = Math.floor(random(seed) * 216);
      const angle = (index / 216) * Math.PI * 2;
      const radius = 1.02 + (index % 3 === 0 ? 0.055 : 0.022);
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;
      z = 0;
      size = 0.0055 + (index % 6 === 0 ? 0.0045 : 0);
    } else {
      // 空间尘埃
      ring = 2;
      const angle = random(seed) * Math.PI * 2;
      const radius = 1.2 + random(seed) * 0.9;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius * 0.94;
      z = (random(seed) - 0.5) * 1.1;
      size = 0.003 + random(seed) * 0.0035;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    seeds[i] = random(seed);
    rings[i] = ring;
    sizes[i] = size;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1));
  geometry.setAttribute('aRing', new Float32BufferAttribute(rings, 1));
  geometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
  return geometry;
}

function cssColor(name: string, fallback: string): Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return new Color(value || fallback);
  } catch {
    return new Color(fallback);
  }
}

interface Palette {
  core: Color;
  mid: Color;
  outer: Color;
  hazeInner: Color;
  hazeOuter: Color;
  limbus: Color;
  pupil: Color;
  pupilEdge: Color;
  catch: Color;
  blend: number; // THREE.AdditiveBlending | THREE.NormalBlending
  heat: number;
  alpha: number;
}

function readPalette(theme: IrisTheme): Palette {
  if (theme === 'day') {
    return {
      core: cssColor('--iris-core', '#2b2117'),
      mid: cssColor('--iris-mid', '#6a4a1e'),
      outer: cssColor('--iris-outer', '#8a7f6a'),
      hazeInner: cssColor('--haze-inner', '#c9b28a'),
      hazeOuter: cssColor('--haze-outer', '#a89a80'),
      limbus: cssColor('--limbus', '#2b2117'),
      pupil: cssColor('--pupil', '#1a1410'),
      pupilEdge: cssColor('--pupil-edge', '#4a3a26'),
      catch: cssColor('--catch', '#fff8ec'),
      blend: NormalBlending,
      heat: 0.25,
      alpha: 0.85,
    };
  }

  return {
    core: cssColor('--iris-core', '#f2eadf'),
    mid: cssColor('--iris-mid', '#d9a441'),
    outer: cssColor('--iris-outer', '#9b8cf0'),
    hazeInner: cssColor('--haze-inner', '#d9a441'),
    hazeOuter: cssColor('--haze-outer', '#4a3f7a'),
    limbus: cssColor('--limbus', '#05070c'),
    pupil: cssColor('--pupil', '#04050a'),
    pupilEdge: cssColor('--pupil-edge', '#3a2a12'),
    catch: cssColor('--catch', '#fff6e6'),
    blend: AdditiveBlending,
    heat: 0.55,
    alpha: 1,
  };
}

/* ------------------------------------------------------------------ renderer */

export function start(canvas: HTMLCanvasElement, tier: Tier): IrisHandle {
  const cfg = TIER_CONFIG[tier];
  const P = IRIS_PARAMS;

  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    powerPreference: 'high-performance',
  });

  const dpr = Math.min(window.devicePixelRatio || 1, cfg.dprCap);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
  camera.position.z = 5;

  const geometry = buildGeometry(cfg.count);
  const points = new Points(geometry, new ShaderMaterial());
  const quad = new PlaneGeometry(2, 2);

  let theme: IrisTheme = (document.documentElement.dataset.theme as IrisTheme) ?? 'night';
  let palette = readPalette(theme);

  const pointsUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: dpr },
    uScale: { value: 500 },
    uDilate: { value: 0 },
    uProgress: { value: 0 },
    uPointerStrength: { value: 0 },
    uGaze: { value: new Float32Array([0, 0]) },
    uPointer: { value: new Float32Array([0, 0]) },
    uMaxGaze: { value: P.maxGaze },
    uPupilCenter: { value: new Float32Array([0, 0]) },
    uPupilRadius: { value: P.pupilRadius },
    uIrisHeat: { value: palette.heat },
    uSizeScale: { value: theme === 'day' ? 1 : 1 },
    uHatch: { value: theme === 'day' ? 1 : 0 },
    uOpacity: { value: palette.alpha },
    uColorCore: { value: palette.core },
    uColorMid: { value: palette.mid },
    uColorOuter: { value: palette.outer },
  };

  points.material = new ShaderMaterial({
    uniforms: pointsUniforms,
    vertexShader: POINTS_VERTEX,
    fragmentShader: POINTS_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: palette.blend,
  });
  points.renderOrder = 2;

  const hazeUniforms = {
    uInner: { value: palette.hazeInner },
    uOuter: { value: palette.hazeOuter },
    uOpacity: { value: theme === 'day' ? 0.18 : 0.32 },
    uTime: { value: 0 },
    uGaze: { value: new Float32Array([0, 0]) },
  };
  const haze = new Mesh(
    quad,
    new ShaderMaterial({
      uniforms: hazeUniforms,
      vertexShader: MESH_VERTEX,
      fragmentShader: HAZE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: palette.blend,
    })
  );
  haze.scale.setScalar(1.05);
  haze.renderOrder = 1;

  const limbusUniforms = {
    uColor: { value: palette.limbus },
    uInner: { value: P.limbusInner },
    uOuter: { value: P.limbusOuter },
    uOpacity: { value: theme === 'day' ? 0.6 : 0.5 },
  };
  const limbus = new Mesh(
    quad,
    new ShaderMaterial({
      uniforms: limbusUniforms,
      vertexShader: MESH_VERTEX,
      fragmentShader: LIMBUS_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: NormalBlending,
    })
  );
  limbus.renderOrder = 3;

  const pupilUniforms = {
    uColor: { value: palette.pupil },
    uEdge: { value: palette.pupilEdge },
    uRadius: { value: 1.0 },
    uOpacity: { value: theme === 'day' ? 0.92 : 0.96 },
  };
  const pupil = new Mesh(
    quad,
    new ShaderMaterial({
      uniforms: pupilUniforms,
      vertexShader: MESH_VERTEX,
      fragmentShader: PUPIL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: NormalBlending,
    })
  );
  pupil.renderOrder = 4;

  const catchUniforms = {
    uColor: { value: palette.catch },
    uOpacity: { value: theme === 'day' ? 0.35 : 0.85 },
  };
  const catchLight = new Mesh(
    quad,
    new ShaderMaterial({
      uniforms: catchUniforms,
      vertexShader: MESH_VERTEX,
      fragmentShader: CATCH_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    })
  );
  catchLight.scale.setScalar(P.catchRadius);
  catchLight.renderOrder = 5;

  scene.add(haze, points, limbus, pupil, catchLight);

  // 验收用：?layers=haze,points 只显示指定层，便于证明"没有第二个残留瞳孔"
  {
    const only = new URLSearchParams(location.search).get('layers');
    if (only) {
      const keep = new Set(only.split(',').map((s) => s.trim()));
      const named: Record<string, Mesh | Points> = { haze, points, limbus, pupil, catch: catchLight };
      Object.entries(named).forEach(([name, obj]) => {
        obj.visible = keep.has(name);
      });
    }
  }

  // 只做"静态"变换：不引用 gaze/dilate（它们此刻还在 TDZ 中），
  // 保证 rAF 暂停时的首帧也不会把瞳孔画成 1.0 半径的黑盘。
  const syncAttachments = () => {
    pupil.scale.setScalar(P.pupilRadius);
    limbus.scale.setScalar(1);
    catchLight.scale.setScalar(P.catchRadius);
    pupil.position.copy(points.position);
    limbus.position.copy(points.position);
    catchLight.position.copy(points.position);
    catchLight.position.x += P.catchOffset.x;
    catchLight.position.y += P.catchOffset.y;
  };

  const layout = () => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);

    const aspect = width / Math.max(1, height);
    // 窄屏：让半径 1.05 的外圈刻度落在横向 92% 内，眼睛不会被裁切
    const halfHeight = aspect < 0.85
      ? Math.max(HALF_HEIGHT, 1.05 / (0.92 * aspect))
      : HALF_HEIGHT;
    const halfWidth = halfHeight * aspect;

    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();

    pointsUniforms.uScale.value = height / (2 * halfHeight);
    pointsUniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, cfg.dprCap);

    // 云整体上移，给底部文案留呼吸
    points.position.set(0, aspect < 0.85 ? halfHeight * 0.3 : 0.12, 0);
    haze.position.copy(points.position);
    limbus.position.copy(points.position);
    pupil.position.copy(points.position);
    catchLight.position.copy(points.position);

    syncAttachments();
    renderer.render(scene, camera);
    canvas.dataset.ready = 'true';
  };

  syncAttachments();
  layout();

  /* ---------------------------------------------------- 凝视状态机（P0） */
  const gaze = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  let state: 'follow' | 'wander' | 'return' = 'wander';
  let pointerActive = false;
  let lastPointerMs = 0;
  let saccadeUntil = 0;
  let fixationUntil = 0;
  let wanderTarget = { x: 0, y: 0 };
  let saccadeFrom = { x: 0, y: 0 };
  let saccadeTo = { x: 0, y: 0 };
  let saccadeStart = 0;
  let saccadeDur = 0;
  let now = 0;

  const pointAt = (deg: number, radiusFrac: number) => ({
    x: Math.cos((deg * Math.PI) / 180) * radiusFrac * P.maxGaze,
    y: Math.sin((deg * Math.PI) / 180) * radiusFrac * P.maxGaze,
  });

  const pickWanderTarget = () => {
    // 避免连续两次看向同一侧：偏向当前注视的反方向
    const curDeg = (Math.atan2(gaze.y, gaze.x) * 180) / Math.PI;
    const opposite = curDeg + (Math.random() > 0.5 ? 120 : -120);
    const deg = opposite + (Math.random() - 0.5) * 110;
    const rf = P.wanderRadiusMin + Math.random() * (P.wanderRadiusMax - P.wanderRadiusMin);
    return pointAt(deg, rf);
  };

  const startSaccade = (to: { x: number; y: number }) => {
    const dx = to.x - gaze.x;
    const dy = to.y - gaze.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-4) return;

    // 角度幅度 → 眼跳时长（D = 20 + 2A ms，A 取注视锥角）
    const ampDeg = (Math.atan2(dist, P.maxGaze) * 180) / Math.PI;
    const durMs = Math.min(P.saccadeMaxMs, Math.max(P.saccadeFloorMs, 20 + 2 * ampDeg));

    saccadeFrom = { x: gaze.x, y: gaze.y };
    saccadeTo = { x: to.x, y: to.y };
    saccadeStart = now;
    saccadeDur = durMs;
    saccadeUntil = now + durMs;
  };

  const enterWander = () => {
    state = 'wander';
    fixationUntil = now + (Math.random() < P.fixLongChance
      ? P.fixLongMs
      : P.fixMinMs + Math.random() * (P.fixMaxMs - P.fixMinMs));
    wanderTarget = pickWanderTarget();
    // 关键：把注视目标也切到漫游点，否则阻尼会把视线又拉回旧的指针位置
    target.x = wanderTarget.x;
    target.y = wanderTarget.y;
    startSaccade(wanderTarget);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    pointerActive = true;
    lastPointerMs = performance.now();
    state = 'follow';
    updatePointer(event.clientX, event.clientY);
  };

  const onPointerLeave = () => {
    pointerActive = false;
    state = 'return';
    pointerTargetStrength = 0;
    dilateTarget = 0;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    // 触摸：一次短的"被注意到"反馈，然后继续自主游走
    dilateTarget = 1;
    window.setTimeout(() => {
      dilateTarget = 0;
    }, 420);
    if (state === 'wander') {
      fixationUntil = Math.min(fixationUntil, now + 500);
    }
  };

  /* ------------------------------------------------ 坐标链（P0 核心修复） */
  let pointerWorld = { x: 0, y: 0 }; // 对象空间（= 世界 − points.position）
  let pointerCss = { x: 0, y: 0 };
  let pointerStrength = 0;
  let pointerTargetStrength = 0;
  let dilate = 0;
  let dilateTarget = 0;

  const updatePointer = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    pointerCss = { x: clientX, y: clientY };

    // 视口坐标 → canvas 局部 NDC（clientX/Y 与 rect 都是视口坐标，不再叠加 scrollY）
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);

    const halfW = (camera.right - camera.left) / 2;
    const halfH = (camera.top - camera.bottom) / 2;

    // 世界坐标 → 对象坐标（关键：减去 points.position）
    const wx = nx * halfW;
    const wy = ny * halfH;
    pointerWorld = { x: wx - points.position.x, y: wy - points.position.y };

    // 注视目标：方向 = 指针方向（对象空间），幅度按距离，上限 maxGaze
    const dist = Math.hypot(pointerWorld.x, pointerWorld.y);
    const clamped = Math.min(1, dist / 1.15);
    const angle = Math.atan2(pointerWorld.y, pointerWorld.x);
    const size = P.maxGaze * clamped;
    target.x = Math.cos(angle) * size;
    target.y = Math.sin(angle) * size;

    pointerTargetStrength = dist < P.repelRadius ? 1 - dist / P.repelRadius : 0;
    dilateTarget = dist < 0.9 ? (0.9 - dist) / 0.9 : 0;
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', onPointerLeave, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });

  /* ------------------------------------------------------------ 滚动 */
  const hero = canvas.closest<HTMLElement>('[data-hero]') ?? document.body;
  const copy = hero.querySelector<HTMLElement>('[data-hero-copy]');
  let dissolve = 0;
  let dissolveTarget = 0;

  const scrollTrigger = ScrollTrigger.create({
    trigger: hero,
    start: 'top top',
    end: 'bottom top',
    scrub: true,
    onUpdate: (self) => {
      dissolveTarget = Math.min(1, Math.max(0, self.progress));
      if (copy) copy.style.opacity = String(Math.max(0, 1 - self.progress * 1.6));
    },
  });

  /* ------------------------------------------------------ 暂停 / 生命周期 */
  let visible = document.visibilityState === 'visible';
  let inView = true;
  let rafId = 0;
  let disposed = false;
  const shouldRun = () => visible && inView && !disposed;

  const onVisibility = () => {
    visible = document.visibilityState === 'visible';
    if (shouldRun()) schedule();
    else cancel();
  };

  const io = new IntersectionObserver(
    (entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      if (shouldRun()) schedule();
      else cancel();
    },
    { rootMargin: '200px' }
  );
  io.observe(hero);

  /* ---------------------------------------------------------- 主循环 */
  let eyeCenterX = 0;
  let eyeCenterY = 0;
  let lastTime = performance.now();
  let elapsed = 0;

  const damp = (current: number, goal: number, lambda: number, dt: number) =>
    current + (goal - current) * (1 - Math.exp(-lambda * dt));

  const frame = (time: number) => {
    rafId = 0;
    if (!shouldRun()) return;

    const dt = Math.min(0.05, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;
    elapsed += dt;
    now = performance.now();

    // --- 状态推进 ---
    if (state === 'follow' && now - lastPointerMs > P.idleMs) {
      // 指针停了：从当前注视点起，开始自主游走
      enterWander();
    } else if (state === 'wander' && now > fixationUntil) {
      enterWander();
    } else if (state === 'return') {
      target.x = 0;
      target.y = 0;
      if (Math.hypot(gaze.x, gaze.y) < 0.01) enterWander();
    }

    // --- 眼跳：按计划曲线推进（不是纯阻尼，保证"快速到位"）---
    if (now < saccadeUntil) {
      const t = Math.min(1, (now - saccadeStart) / saccadeDur);
      // easeOutCubic：起步快、末端自然减速
      const e = 1 - Math.pow(1 - t, 3);
      gaze.x = saccadeFrom.x + (saccadeTo.x - saccadeFrom.x) * e;
      gaze.y = saccadeFrom.y + (saccadeTo.y - saccadeFrom.y) * e;
    } else {
      const lambda =
        state === 'return' ? P.lambdaReturn : now - lastPointerMs < 120 ? P.lambdaSaccade : P.lambdaFollow;
      gaze.x = damp(gaze.x, target.x, lambda, dt);
      gaze.y = damp(gaze.y, target.y, lambda, dt);
    }

    // 幅度上限（对象空间，圆形而非方形）
    const mag = Math.hypot(gaze.x, gaze.y);
    if (mag > P.maxGaze) {
      gaze.x = (gaze.x / mag) * P.maxGaze;
      gaze.y = (gaze.y / mag) * P.maxGaze;
    }

    // 微漂移（固定频率，不是每帧随机）
    const drift = (P.microDriftDeg * Math.PI) / 180;
    const dx = Math.sin(elapsed * 0.37) * drift * P.maxGaze;
    const dy = Math.cos(elapsed * 0.29 + 1.7) * drift * P.maxGaze;

    pointerStrength = damp(pointerStrength, pointerTargetStrength, 6, dt);
    dilate = damp(dilate, dilateTarget, 4, dt);
    dissolve = damp(dissolve, dissolveTarget, 6, dt);

    pointsUniforms.uTime.value = elapsed;
    pointsUniforms.uGaze.value[0] = gaze.x;
    pointsUniforms.uGaze.value[1] = gaze.y;
    pointsUniforms.uPointer.value[0] = pointerWorld.x;
    pointsUniforms.uPointer.value[1] = pointerWorld.y;
    pointsUniforms.uPointerStrength.value = pointerStrength;
    pointsUniforms.uProgress.value = dissolve;
    pointsUniforms.uDilate.value = dilate;

    hazeUniforms.uTime.value = elapsed;
    hazeUniforms.uGaze.value[0] = gaze.x;
    hazeUniforms.uGaze.value[1] = gaze.y;

    // 统一眼睛坐标系：极点在球面旋转后的正交投影 = 瞳孔中心
    const cosG = Math.sqrt(Math.max(0, 1 - gaze.x * gaze.x - gaze.y * gaze.y));
    const eyeX = gaze.x + dx * 0.35;
    const eyeY = cosG * gaze.y + dy * 0.35;

    pointsUniforms.uPupilCenter.value[0] = eyeX;
    pointsUniforms.uPupilCenter.value[1] = eyeY;
    eyeCenterX = eyeX;
    eyeCenterY = eyeY;

    pupil.position.set(points.position.x + eyeX, points.position.y + eyeY, 0);
    pupil.scale.setScalar(P.pupilRadius * (1 + dilate * 0.12));

    // 角膜缘是"轮廓"，球面旋转时几乎不动
    limbus.position.set(
      points.position.x + eyeX * 0.12,
      points.position.y + eyeY * 0.12,
      0
    );
    limbus.scale.setScalar(1);

    haze.position.set(
      points.position.x + eyeX * 0.45,
      points.position.y + eyeY * 0.45,
      0
    );

    // 角膜高光：贴在角膜上，随眼球反向小幅移动
    catchLight.position.set(
      points.position.x - eyeX * 0.22 + P.catchOffset.x,
      points.position.y - eyeY * 0.22 + P.catchOffset.y,
      0
    );
    catchLight.scale.setScalar(P.catchRadius * (1 + dilate * 0.1));

    renderer.render(scene, camera);
    canvas.dataset.ready = 'true';

    rafId = window.requestAnimationFrame(frame);
  };

  function schedule() {
    if (rafId || !shouldRun()) return;
    lastTime = performance.now();
    rafId = window.requestAnimationFrame(frame);
  }

  function cancel() {
    if (!rafId) return;
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  document.addEventListener('visibilitychange', onVisibility);

  const resizeObserver = new ResizeObserver(() => layout());
  resizeObserver.observe(canvas);

  const onContextLost = (event: Event) => {
    event.preventDefault();
    cancel();
    canvas.dataset.ready = 'false';
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  /* --------------------------------------------------------- 主题切换 */
  const applyTheme = (next: IrisTheme) => {
    theme = next;
    palette = readPalette(theme);

    pointsUniforms.uColorCore.value = palette.core;
    pointsUniforms.uColorMid.value = palette.mid;
    pointsUniforms.uColorOuter.value = palette.outer;
    pointsUniforms.uIrisHeat.value = palette.heat;
    pointsUniforms.uSizeScale.value = 1;
    pointsUniforms.uHatch.value = theme === 'day' ? 1 : 0;
    pointsUniforms.uOpacity.value = palette.alpha;

    hazeUniforms.uInner.value = palette.hazeInner;
    hazeUniforms.uOuter.value = palette.hazeOuter;
    hazeUniforms.uOpacity.value = theme === 'day' ? 0 : 0.32;

    limbusUniforms.uColor.value = palette.limbus;
    limbusUniforms.uOpacity.value = theme === 'day' ? 0 : 0.34;

    pupilUniforms.uColor.value = palette.pupil;
    pupilUniforms.uEdge.value = palette.pupilEdge;
    pupilUniforms.uOpacity.value = theme === 'day' ? 0.9 : 0.96;

    catchUniforms.uColor.value = palette.catch;
    catchUniforms.uOpacity.value = theme === 'day' ? 0.35 : 0.85;

    // 白天关掉雾光与角膜缘环：它们在纸上是灰色环带，会读成塑料镜筒
    haze.visible = theme !== 'day';
    limbus.visible = theme !== 'day';

    // blending 是渲染状态，不是 uniform：必须改材质并重新编译
    const mats = [points.material, haze.material] as ShaderMaterial[];
    mats.forEach((m) => {
      if (m.blending !== palette.blend) {
        m.blending = palette.blend;
        m.needsUpdate = true;
      }
    });

    renderer.render(scene, camera);
  };

  applyTheme(theme);

  const themeObserver = new MutationObserver(() => {
    const next = (document.documentElement.dataset.theme as IrisTheme) ?? 'night';
    if (next !== theme) applyTheme(next);
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  renderer.render(scene, camera);
  canvas.dataset.ready = 'true';
  enterWander();
  schedule();

  /* ------------------------------------------------------------- 调试 */
  const debugEnabled = new URLSearchParams(location.search).get('debug') === 'iris';
  let debugCleanup: (() => void) | null = null;

  if (debugEnabled) {
    import('./debug')
      .then((mod) => {
        debugCleanup = mod.mountDebugMarkers({
          canvas,
          camera,
          points,
          getPointerCss: () => pointerCss,
          getPointerObject: () => pointerWorld,
          getGaze: () => gaze,
          getMaxGaze: () => P.maxGaze,
          getEyeCenter: () => ({ x: eyeCenterX, y: eyeCenterY }),
          isPointerActive: () => pointerActive,
        });
      })
      .catch(() => {});
  }

  // 坐标链探针：随时按需计算三条位置（不改 DOM，避免自动化观察被打断）
  (window as unknown as Record<string, unknown>).__irisProbe = () => {
    const rect = canvas.getBoundingClientRect();
    const halfW = (camera.right - camera.left) / 2;
    const halfH = (camera.top - camera.bottom) / 2;
    const toScreen = (wx: number, wy: number) => ({
      x: rect.left + (wx / halfW * 0.5 + 0.5) * rect.width,
      y: rect.top + (0.5 - (wy / halfH) * 0.5) * rect.height,
    });
    const raw = toScreen(pointerWorld.x, pointerWorld.y);
    const center = toScreen(pointerWorld.x + points.position.x, pointerWorld.y + points.position.y);
    return {
      css: pointerCss,
      shaderRaw: raw,
      center,
      deltaCssCenter: Math.hypot(center.x - pointerCss.x, center.y - pointerCss.y),
      deltaCssRaw: Math.hypot(raw.x - pointerCss.x, raw.y - pointerCss.y),
      objectOffsetY: points.position.y,
      eyeCenter: { x: eyeCenterX, y: eyeCenterY },
      instrumentCenter: { x: points.position.x, y: points.position.y },
      pupilInsideIris: Math.hypot(eyeCenterX, eyeCenterY) + P.pupilRadius <= 0.95,
      rect: { w: rect.width, h: rect.height },
      dpr: renderer.getPixelRatio(),
      scrollY: window.scrollY,
    };
  };
  // 供自动化验收读取（不参与渲染）
  (window as unknown as Record<string, unknown>).__iris = {
    getState: () => ({
      state,
      gazeDeg: (Math.atan2(gaze.y, gaze.x) * 180) / Math.PI,
      gazeMag: Math.hypot(gaze.x, gaze.y) / P.maxGaze,
      targetDeg: (Math.atan2(target.y, target.x) * 180) / Math.PI,
      pointerActive,
      theme,
      pointerCss,
      pointerObject: pointerWorld,
      saccadeActive: performance.now() < saccadeUntil,
      msSincePointer: performance.now() - lastPointerMs,
      dpr: renderer.getPixelRatio(),
      drawCalls: renderer.info.render.calls,
      count: cfg.count,
    }),
  };

  /* ------------------------------------------------------------- 释放 */
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancel();
    io.disconnect();
    resizeObserver.disconnect();
    themeObserver.disconnect();
    scrollTrigger.kill();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    debugCleanup?.();

    geometry.dispose();
    quad.dispose();
    [points, haze, limbus, pupil, catchLight].forEach((obj) => {
      (obj as Mesh).material?.dispose?.();
    });
    renderer.dispose();
    renderer.forceContextLoss();
    delete (window as unknown as Record<string, unknown>).__iris;
  };

  window.addEventListener('pagehide', dispose, { once: true });

  return { dispose, setTheme: applyTheme };
}
