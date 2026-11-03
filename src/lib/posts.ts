import { getCollection, type CollectionEntry } from 'astro:content';
import { CATEGORY_MAP, type CategoryKey } from '../data/categories';

export type Post = CollectionEntry<'posts'>;

/** 只取已发布文章，按日期倒序（getCollection 不保证顺序） */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export async function getPostsByCategory(category: CategoryKey): Promise<Post[]> {
  const posts = await getPosts();
  return posts.filter((post) => post.data.category === category);
}

/** id 形如 cs/particle-dissolve → 取末段作为 URL slug */
export function postSlug(post: Post): string {
  return post.id.split('/').pop() ?? post.id;
}

export function postHref(post: Post): string {
  return `/writing/${post.data.category}/${postSlug(post)}`;
}

export function postDate(post: Post): string {
  return post.data.date.toISOString().slice(0, 10);
}

/** 中文按 400 字/分钟、英文按 200 词/分钟估算 */
export function readingMinutes(post: Post): number {
  const raw = post.body ?? '';
  const han = (raw.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const words = raw
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  const minutes = han / 400 + words / 200;
  return Math.max(1, Math.round(minutes));
}

export function categoriesOf(posts: Post[]): Array<{ key: CategoryKey; count: number }> {
  return (Object.keys(CATEGORY_MAP) as CategoryKey[]).map((key) => ({
    key,
    count: posts.filter((post) => post.data.category === key).length,
  }));
}

/** 同分类内的上一篇 / 下一篇；不足时跨分类补齐 */
export function neighbours(posts: Post[], current: Post): { prev: Post | null; next: Post | null } {
  const sameCategory = posts.filter((post) => post.data.category === current.data.category);
  const index = sameCategory.findIndex((post) => post.id === current.id);

  if (index === -1) {
    return { prev: null, next: null };
  }

  return {
    prev: sameCategory[index - 1] ?? null,
    next: sameCategory[index + 1] ?? null,
  };
}

export function allTags(posts: Post[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  posts.forEach((post) => {
    post.data.tags.forEach((tag) => {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
