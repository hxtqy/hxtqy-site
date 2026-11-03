import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts, postHref } from '../lib/posts';

export async function GET(context: APIContext) {
  const posts = await getPosts();

  return rss({
    title: 'hxtqy · 千面之眼',
    description: 'CS、AI、Math、Poem 四类笔记。',
    site: context.site ?? 'https://hxtqy.com',
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.summary,
      pubDate: post.data.date,
      link: postHref(post),
      categories: [post.data.category, ...post.data.tags],
    })),
    customData: '<language>zh-cn</language>',
  });
}
