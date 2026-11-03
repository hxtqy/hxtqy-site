import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { CATEGORY_KEYS } from './data/categories';

/**
 * Astro 7 的 Content Layer API：
 * - 定义在 src/content.config.ts（不是 src/content/config.ts）
 * - 每个集合必须有 loader；z 从 astro/zod 导入
 * - slug 字段已移除，条目 id 由 loader 生成（这里 = 相对 base 的路径，如 cs/particle-dissolve）
 */
const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string().max(160),
      date: z.coerce.date(),
      updated: z.coerce.date().optional(),
      category: z.enum(CATEGORY_KEYS),
      tags: z.array(z.string()).default([]),
      lang: z.enum(['zh-Hans', 'en']).default('zh-Hans'),
      draft: z.boolean().default(false),
      cover: image().optional(),
      coverAlt: z.string().optional(),

      /** AI 类：论文元信息 */
      paper: z
        .object({
          title: z.string(),
          authors: z.array(z.string()).default([]),
          venue: z.string().optional(),
          year: z.number().optional(),
          url: z.string().optional(),
        })
        .optional(),

      /** Math 类：难度 1–5 */
      difficulty: z.number().min(1).max(5).optional(),

      /** Poem 类：体裁 */
      poemForm: z.enum(['格律诗', '自由诗', '译诗']).optional(),
    }),
});

export const collections = { posts };
