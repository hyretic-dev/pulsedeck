import type { APIRoute } from 'astro';
import { SITE_URL } from '../config';

// Alle Seiten der Website sind öffentlich und sollen gefunden werden – auch von KI-Suchsystemen (ChatGPT, Claude, Perplexity,
// Gemini). Die KI-Crawler stehen ausdrücklich da, damit niemand sie später aus Versehen mit einer Pauschalregel aussperrt.
const KI_CRAWLER = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot'];

export const GET: APIRoute = () =>
  new Response(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      '',
      ...KI_CRAWLER.map((bot) => `User-agent: ${bot}`),
      'Allow: /',
      'Disallow: /api/',
      '',
      `Sitemap: ${SITE_URL}/sitemap-index.xml`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );
