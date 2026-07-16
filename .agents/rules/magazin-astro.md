---
description: Astro-Magazin-Konventionen (Astro 6, MDX, Tailwind 4, SEO, Performance)
globs: magazin/**/*
alwaysApply: false
---

# Magazin: Astro

## Framework & Stack

- **Astro 6** mit MDX-Support (`@astrojs/mdx`).
- **Tailwind 4** via `@tailwindcss/vite` + `@tailwindcss/typography` für Prosa-Inhalte.
- **Sitemap** automatisch via `@astrojs/sitemap`.
- **Bildoptimierung** über `sharp`.

## Content-Struktur

- Blog-Posts unter `magazin/src/content/blog/` als `.md` oder `.mdx`.
- Autoren-Daten unter `magazin/src/content/authors/` als `.json`.
- Layouts unter `magazin/src/layouts/`.
- Wiederverwendbare Komponenten unter `magazin/src/components/`.

## SEO — Pflicht für jeden Post

Jeder Blog-Post braucht vollständiges Frontmatter:

```yaml
---
title: "Aussagekräftiger Titel"
description: "Kompakte Meta-Description für Suchmaschinen"
pubDate: "2026-07-16"
tags: ["tag1", "tag2"]
author: "author-slug"
heroImage: "/blog/image.jpg"  # optional
---
```

- `title`: Aussagekräftig, keine generischen Titel.
- `description`: 150–160 Zeichen, für Suchmaschinen optimiert.
- `pubDate`: ISO-Format.
- `tags`: Mindestens ein Tag.

## Styles

- Tailwind 4 für Layouts und Komponenten.
- `@tailwindcss/typography` (`prose`-Klassen) für Blog-Content.
- Keine Inline-Styles.

## Performance

- Bilder: Astro `<Image />` oder `<Picture />` Komponenten für automatische Optimierung. Lazy Loading als Default.
- Kein Client-seitiges JavaScript, wenn nicht zwingend nötig (Astro's Island-Architektur).
- Mermaid-Diagramme: Bestehende `Mermaid.astro`-Komponente verwenden.

## Isolation

- Das Magazin ist ein eigenständiges Sub-Projekt mit eigenem `package.json`, eigenen Dependencies und eigenem Build.
- **Keine** Angular-, Supabase- oder PrimeNG-Abhängigkeiten im Magazin.
- Gemeinsame Konfiguration (z.B. Site-URL) über `magazin/src/consts.ts`.
