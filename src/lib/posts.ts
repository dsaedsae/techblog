import { getCollection, type CollectionEntry } from 'astro:content';
import { withBase } from './url';
import type { SeriesId } from '../consts';

export type Post = CollectionEntry<'blog'>;

/** draft가 아닌 글을 최신순으로 반환한다. */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function postUrl(post: Post): string {
  return withBase(`/blog/${post.id}/`);
}

export function categoryUrl(category: string): string {
  return withBase(`/categories/${category}/`);
}

export function tagUrl(tag: string): string {
  return withBase(`/tags/${encodeURIComponent(tag)}/`);
}

export function seriesUrl(series: string): string {
  return withBase(`/series/${series}/`);
}

/** 해당 시리즈의 글을 회차 순서로 반환한다. */
export async function getSeriesPosts(series: SeriesId): Promise<Post[]> {
  const posts = await getCollection(
    'blog',
    ({ data }) => !data.draft && data.series === series
  );
  return posts.sort((a, b) => (a.data.seriesOrder ?? 0) - (b.data.seriesOrder ?? 0));
}

/** 태그별 글 수를 내림차순으로 반환한다. */
export function collectTags(posts: Post[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
