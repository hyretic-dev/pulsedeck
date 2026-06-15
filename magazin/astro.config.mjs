// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';
import fs from 'fs';

import tailwindcss from '@tailwindcss/vite';

/**
 * @param {string} slug 
 * @returns {Date}
 */
const getDatesFromSlug = (slug) => {
  try {
    const mdPath = `./src/content/blog/${slug}.md`;
    const mdxPath = `./src/content/blog/${slug}.mdx`;
    let content = '';
    if (fs.existsSync(mdPath)) content = fs.readFileSync(mdPath, 'utf8');
    else if (fs.existsSync(mdxPath)) content = fs.readFileSync(mdxPath, 'utf8');
    
    if (content) {
      const pubDateMatch = content.match(/pubDate:\s*['"]?([^'"\n]+)['"]?/);
      const updatedDateMatch = content.match(/updatedDate:\s*['"]?([^'"\n]+)['"]?/);
      const lastModifiedMatch = content.match(/last_modified:\s*['"]?([^'"\n]+)['"]?/);
      
      const lastModStr = (lastModifiedMatch && lastModifiedMatch[1]) || (updatedDateMatch && updatedDateMatch[1]) || (pubDateMatch && pubDateMatch[1]);
      if (lastModStr) return new Date(lastModStr);
    }
  } catch (e) {}
  return new Date();
};

// https://astro.build/config
export default defineConfig({
  site: 'https://pulsedeck.de',
  base: '/magazin',
  integrations: [
      mdx(), 
      sitemap({
          serialize(item) {
            if (item.url.includes('/blog/')) {
              const urlObj = new URL(item.url);
              const parts = urlObj.pathname.split('/').filter(Boolean);
              if (parts[parts.length - 1] !== 'blog') {
                  const slug = parts[parts.length - 1];
                  item.lastmod = getDatesFromSlug(slug).toISOString();
                  item.changefreq = /** @type {any} */ ('weekly');
                  item.priority = 0.8;
              } else {
                  item.changefreq = /** @type {any} */ ('daily');
                  item.priority = 0.9;
              }
            } else {
              item.changefreq = /** @type {any} */ ('daily');
              item.priority = 1.0;
            }
            return item;
          }
      })
  ],

  fonts: [
      {
          provider: fontProviders.local(),
          name: 'Atkinson',
          cssVariable: '--font-atkinson',
          fallbacks: ['sans-serif'],
          options: {
              variants: [
                  {
                      src: ['./src/assets/fonts/atkinson-regular.woff'],
                      weight: 400,
                      style: 'normal',
                      display: 'swap',
                  },
                  {
                      src: ['./src/assets/fonts/atkinson-bold.woff'],
                      weight: 700,
                      style: 'normal',
                      display: 'swap',
                  },
              ],
          },
      },
	],

  vite: {
    plugins: [tailwindcss()],
  },
});