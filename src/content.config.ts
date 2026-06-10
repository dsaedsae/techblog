import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { CATEGORY_IDS, SERIES_IDS } from './consts';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: z
    .object({
      title: z.string(),
      description: z.string(),
      date: z.coerce.date(),
      category: z.enum(CATEGORY_IDS),
      tags: z.array(z.string()),
      series: z.enum(SERIES_IDS).optional(),
      seriesOrder: z.number().int().positive().optional(),
      draft: z.boolean().default(false),
    })
    .refine((data) => !data.series || data.seriesOrder !== undefined, {
      message: 'series가 지정된 글은 seriesOrder(회차 번호)도 함께 지정해야 합니다.',
    }),
});

export const collections = { blog };
