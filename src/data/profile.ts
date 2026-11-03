/**
 * 个人档案：全部为可替换的占位内容（placeholder: true 的条目会在页面上标注）。
 * 替换本文件即可更新 About 页，不需要动模板。
 */

export interface ProfileLink {
  label: string;
  href: string;
  external?: boolean;
  /** true = 占位，需要替换 */
  placeholder?: boolean;
}

export interface TimelineItem {
  year: string;
  text: string;
  now?: boolean;
  placeholder?: boolean;
}

export const PROFILE = {
  name: 'hxtqy',
  /** 首页大标题 */
  title: '千面之眼',
  tagline: '把读过的、写下的、推出来的，放在同一处。',
  intro: [
    '这是一台观测仪器的入口：一个会看向你的首页，和一间用来长期堆放笔记的房间。',
    '文章按四类归档——CS、AI、Math、Poem。前三类是工作，最后一类是呼吸。',
  ],
  lede: '写作是唯一的凝视。',
  /** 现在 */
  now: [
    { label: '在读', value: '留出位置：最近在读的书或论文。', placeholder: true },
    { label: '在写', value: '留出位置：正在推进的稿子。', placeholder: true },
    { label: '在做', value: '本站的粒子虹膜与阅读系统。', placeholder: false },
  ],
  interests: ['光学仪器与几何', '类型系统', '优化与推导', '诗歌翻译', '暗房与银盐'],
  timeline: [
    {
      year: '现在',
      text: '把散在各处的笔记搬进这个站点，按 CS / AI / Math / Poem 归档。',
      now: true,
    },
    { year: '2025', text: '留出位置：一条经历或研究方向的转变。', placeholder: true },
    { year: '2024', text: '留出位置：一条经历。', placeholder: true },
    { year: '更早', text: '留出位置：起点。', placeholder: true },
  ] satisfies TimelineItem[],
  contacts: [
    { label: 'GitHub', href: 'https://github.com/hxtqy', external: true },
    { label: 'RSS', href: '/rss.xml' },
    {
      label: 'Email',
      href: '{{EMAIL_m4x2pifd}}',
      placeholder: true,
    },
  ] satisfies ProfileLink[],
  /** 页面底部的一行说明：哪些内容还是占位 */
  hasPlaceholders: true,
} as const;

export function hasAnyPlaceholder(): boolean {
  return (
    PROFILE.now.some((item) => item.placeholder) ||
    PROFILE.timeline.some((item) => item.placeholder) ||
    PROFILE.contacts.some((item) => item.placeholder)
  );
}
