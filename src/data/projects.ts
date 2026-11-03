/**
 * 项目列表：手工维护。
 * 点击整行直接跳转 repo，因此这里没有详情页，也没有正文内容。
 * cover 可选；缺省时页面用同心环占位图（不引入假截图）。
 */
export interface Project {
  name: string;
  description: string;
  tags: string[];
  repo: string;
  /** 可选封面：放在 src/assets/projects/ 下，或直接写外链 */
  cover?: string;
  /** 维护状态，仅用于排序与文案 */
  status: 'active' | 'maintained' | 'archived';
  year: number;
}

export const PROJECTS: Project[] = [
  {
    name: 'hxtqy-site',
    description: '本站。Astro 静态站点，粒子虹膜首页与长文阅读系统。',
    tags: ['Astro', 'Tailwind', 'Three.js', 'GSAP'],
    repo: 'https://github.com/hxtqy/hxtqy-site',
    status: 'active',
    year: 2026,
  },
  {
    name: 'seed-agent',
    description: '一个把长任务拆成可检查步骤的智能体实验。',
    tags: ['Python', 'LLM', 'Tooling'],
    repo: 'https://github.com/hxtqy',
    status: 'maintained',
    year: 2025,
  },
  {
    name: 'observatory-notes',
    description: '阅读与推导的笔记仓库：论文拆解、习题、片段。',
    tags: ['Markdown', 'LaTeX', 'Notes'],
    repo: 'https://github.com/hxtqy',
    status: 'maintained',
    year: 2025,
  },
  {
    name: 'iris-prototype',
    description: '粒子虹膜的原型实验：凝视追踪、噪声溶解、显存预算。',
    tags: ['GLSL', 'WebGL', 'Experiment'],
    repo: 'https://github.com/hxtqy',
    status: 'archived',
    year: 2026,
  },
];

const STATUS_ORDER: Record<Project['status'], number> = {
  active: 0,
  maintained: 1,
  archived: 2,
};

/** 维护中 → 最近提交 → 归档 */
export function sortedProjects(): Project[] {
  return [...PROJECTS].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return b.year - a.year;
  });
}
