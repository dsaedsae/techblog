// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

/**
 * 코드 펜스 메타의 `title="..."`를 pre 태그의 data-title 속성으로 옮기는
 * Shiki 트랜스포머. 예: ```hcl title="main.tf"
 */
const transformerCodeTitle = {
  name: 'code-title',
  pre(node) {
    const raw = this.options.meta?.__raw ?? '';
    const match = raw.match(/title="([^"]+)"/);
    if (match) node.properties['data-title'] = match[1];
  },
};

// https://astro.build/config
export default defineConfig({
  site: 'https://dsaedsae.github.io',
  base: '/techblog',
  integrations: [mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      transformers: [transformerCodeTitle],
    },
  },
});
