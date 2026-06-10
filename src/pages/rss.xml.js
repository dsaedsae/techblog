import rss from '@astrojs/rss';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';
import { getPosts } from '../lib/posts';
import { withBase } from '../lib/url';

export async function GET(context) {
  const posts = await getPosts();
  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    // 채널 link에도 base('/techblog')가 포함되도록 site에 base를 붙인다
    site: new URL(import.meta.env.BASE_URL, context.site).href,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: withBase(`/blog/${post.id}/`),
      categories: [post.data.category, ...post.data.tags],
    })),
    customData: '<language>ko</language>',
  });
}
