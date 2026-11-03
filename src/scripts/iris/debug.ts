/**
 * `?debug=iris` 专用叠层：把三条坐标链的位置同时画在屏幕上，用来证明/证伪偏移。
 *
 *   M1  实际鼠标位置（clientX/clientY，视口坐标）
 *   M2  着色器里的 uPointer（对象空间，未加对象变换）
 *   M3  屏幕上的实际排斥中心（uPointer + points.position → 世界 → 屏幕）
 *
 * 修复正确的判定：M1 与 M3 重合（≤ 1px）；M2 会比 M3 高出一个 points.position.y。
 */
import type { OrthographicCamera, Points } from 'three';

interface DebugOptions {
  canvas: HTMLCanvasElement;
  camera: OrthographicCamera;
  points: Points;
  getPointerCss: () => { x: number; y: number };
  getPointerObject: () => { x: number; y: number };
  getGaze: () => { x: number; y: number };
  getMaxGaze: () => number;
  getEyeCenter: () => { x: number; y: number };
  isPointerActive: () => boolean;
}

const LABELS = ['鼠标 CSS 坐标', 'Shader uPointer（对象空间）', '实际排斥中心', '仪器中心（固定）', '瞳孔中心（转动）'] as const;
const COLORS = ['#7ad0ff', '#ffcc55', '#7dff9a', '#c9a0ff', '#ff8f6b'] as const;

export function mountDebugMarkers(opts: DebugOptions): () => void {
  const root = document.createElement('div');
  root.setAttribute('data-iris-debug', '');
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '60',
    pointerEvents: 'none',
    font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
  });

  const markers = LABELS.map((label, index) => {
    const marker = document.createElement('div');
    Object.assign(marker.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '18px',
      height: '18px',
      marginLeft: '-9px',
      marginTop: '-9px',
      border: `1px solid ${COLORS[index]}`,
      borderRadius: '50%',
      willChange: 'transform',
    });
    const tag = document.createElement('span');
    tag.textContent = `${index + 1}`;
    Object.assign(tag.style, {
      position: 'absolute',
      left: '20px',
      top: '-4px',
      color: COLORS[index],
      whiteSpace: 'nowrap',
    });
    marker.append(tag);
    root.append(marker);
    return marker;
  });

  const readout = document.createElement('div');
  Object.assign(readout.style, {
    position: 'absolute',
    left: '16px',
    bottom: '16px',
    padding: '8px 10px',
    background: 'rgba(4,6,11,0.78)',
    border: '1px solid rgba(217,164,65,0.35)',
    borderRadius: '4px',
    color: '#e9e6df',
    whiteSpace: 'pre',
  });
  root.append(readout);
  document.body.append(root);

  const halfW = () => (opts.camera.right - opts.camera.left) / 2;
  const halfH = () => (opts.camera.top - opts.camera.bottom) / 2;

  const project = (worldX: number, worldY: number) => {
    const rect = opts.canvas.getBoundingClientRect();
    const ndcX = worldX / halfW();
    const ndcY = worldY / halfH();
    return {
      x: rect.left + (ndcX * 0.5 + 0.5) * rect.width,
      y: rect.top + (0.5 - ndcY * 0.5) * rect.height,
    };
  };

  let raf = 0;
  const update = () => {
    const css = opts.getPointerCss();
    const obj = opts.getPointerObject();
    const off = opts.points.position;
    const gaze = opts.getGaze();
    const maxGaze = opts.getMaxGaze();

    const m2 = project(obj.x, obj.y);
    const m3 = project(obj.x + off.x, obj.y + off.y);

    markers[0].style.transform = `translate3d(${css.x}px, ${css.y}px, 0)`;
    markers[1].style.transform = `translate3d(${m2.x}px, ${m2.y}px, 0)`;
    markers[2].style.transform = `translate3d(${m3.x}px, ${m3.y}px, 0)`;

    const ec = opts.getEyeCenter();
    const m4 = project(off.x, off.y);              // 仪器中心（固定）
    const m5 = project(off.x + ec.x, off.y + ec.y); // 瞳孔中心（转动）
    markers[3].style.transform = `translate3d(${m4.x}px, ${m4.y}px, 0)`;
    markers[4].style.transform = `translate3d(${m5.x}px, ${m5.y}px, 0)`;

    const d13 = Math.hypot(m3.x - css.x, m3.y - css.y);
    const d12 = Math.hypot(m2.x - css.x, m2.y - css.y);

    readout.textContent = [
      `1 ${LABELS[0]}      (${css.x.toFixed(1)}, ${css.y.toFixed(1)})`,
      `2 ${LABELS[1]}  (${m2.x.toFixed(1)}, ${m2.y.toFixed(1)})  Δ1=${d12.toFixed(1)}px`,
      `3 ${LABELS[2]}          (${m3.x.toFixed(1)}, ${m3.y.toFixed(1)})  Δ1=${d13.toFixed(1)}px`,
      `gaze ${((Math.atan2(gaze.y, gaze.x) * 180) / Math.PI).toFixed(0)}°  r=${(Math.hypot(gaze.x, gaze.y) / maxGaze).toFixed(2)}R`,
      `object offset y=${off.y.toFixed(3)}  pointerActive=${opts.isPointerActive()}`,
    ].join('\n');

    (window as unknown as Record<string, unknown>).__irisDebug = {
      css,
      shaderRaw: m2,
      center: m3,
      deltaCssToCenter: d13,
      deltaCssToRaw: d12,
    };
  };

  // 先同步跑一次：即使标签页在后台（rAF 暂停），叠层与数值也是可用的
  update();
  const frame = () => {
    raf = requestAnimationFrame(frame);
    update();
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    root.remove();
    delete (window as unknown as Record<string, unknown>).__irisDebug;
  };
}
