/**
 * 文章分类：单一数据源。
 * 新增分类只需在此追加一项，并同步 content.config.ts 里的 z.enum。
 * hue 使用 CSS 变量名（而不是裸 hex），保证亮/暗两套主题下自动适配。
 */
export const CATEGORY_KEYS = ['cs', 'ai', 'math', 'poem'] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export interface CategoryMeta {
  key: CategoryKey;
  label: string;
  en: string;
  blurb: string;
  hue: string;
  /** 分类在 URL 与目录中的段落名 */
  slug: string;
}

export const CATEGORIES: CategoryMeta[] = [
  {
    key: 'cs',
    label: 'CS',
    en: 'Computer Science',
    blurb: '系统、工程实践与实现细节。',
    hue: 'var(--cyan)',
    slug: 'cs',
  },
  {
    key: 'ai',
    label: 'AI',
    en: 'Artificial Intelligence',
    blurb: '论文阅读、实验记录与方法比较。',
    hue: 'var(--violet)',
    slug: 'ai',
  },
  {
    key: 'math',
    label: 'Math',
    en: 'Mathematics',
    blurb: '分析、优化、推导与竞赛题。',
    hue: 'var(--gold)',
    slug: 'math',
  },
  {
    key: 'poem',
    label: 'Poem',
    en: 'Poetry',
    blurb: '诗，以及关于诗的笔记。',
    hue: 'var(--rose)',
    slug: 'poem',
  },
];

export const CATEGORY_MAP = Object.fromEntries(
  CATEGORIES.map((category) => [category.key, category])
) as Record<CategoryKey, CategoryMeta>;

export function categoryHue(key: CategoryKey): string {
  return CATEGORY_MAP[key]?.hue ?? 'var(--text-3)';
}

export function categoryLabel(key: CategoryKey): string {
  return CATEGORY_MAP[key]?.label ?? key;
}
