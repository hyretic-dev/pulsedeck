import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Pool } from 'pg';

import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { maskiere } from '../mail/mail-templates';

// Startseite, Handbuch, Impressum und Datenschutz gehören zur Website (website/) und stehen in deren Sitemap.
const STATISCHE_SEITEN = ['/login', '/registrieren', '/erstellen', '/organisationen'];

/** Sitemap der Anwendung für Suchmaschinen: feste Seiten der Anwendung plus die öffentlichen Seiten aller Organisationen (Ersatz der Edge Function sitemap). */
@ApiTags('public')
@Controller('public')
export class SitemapController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  /** robots.txt mit der Sitemap-Adresse dieser Instanz (APP_BASE_URL); nginx liefert sie unter /robots.txt aus. */
  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  robots(): string {
    return `User-agent: *\nAllow: /\n\nSitemap: ${this.config.appBaseUrl.replace(/\/+$/, '')}/sitemap.xml\n`;
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async sitemap(): Promise<string> {
    const basis = this.config.appBaseUrl.replace(/\/+$/, '');
    const { rows } = await this.pool.query<{ slug: string; updated_at: Date | null }>('SELECT slug, updated_at FROM organizations ORDER BY slug');
    const eintrag = (pfad: string, haeufigkeit: string, prioritaet: string, geaendert?: string) =>
      `  <url>\n    <loc>${maskiere(basis + pfad)}</loc>\n${geaendert ? `    <lastmod>${geaendert}</lastmod>\n` : ''}    <changefreq>${haeufigkeit}</changefreq>\n    <priority>${prioritaet}</priority>\n  </url>\n`;
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      STATISCHE_SEITEN.map((s) => eintrag(s, 'monthly', '0.8')).join('') +
      rows.map((o) => eintrag(`/${encodeURIComponent(o.slug)}`, 'weekly', '1.0', (o.updated_at ?? new Date()).toISOString().split('T')[0])).join('') +
      '</urlset>\n'
    );
  }
}
