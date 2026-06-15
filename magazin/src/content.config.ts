import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			// SEO Overrides
			seo_title: z.string().optional(),
			seo_description: z.string().optional(),
			
			// Transform string to Date object
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			last_modified: z.coerce.date().optional(),
			
			// Taxonomy
			author: z.string().optional(),
			category: z.string().optional(),
			tags: z.array(z.string()).default([]),
			
			// Publishing state & URLs
			draft: z.boolean().default(false),
			canonical_url: z.string().url().optional(),
			
			// AEO & Relational
			summary: z.string().optional(),
			related_posts: z.array(z.string()).optional(),
			
			// FAQ schema
			faq: z.array(
				z.object({
					question: z.string(),
					answer: z.string()
				})
			).optional(),

			heroImage: z.optional(image()),
			
			// Pulsedeck SEO & Funnel Fields
			type: z.enum(['post', 'template', 'guide']).default('post'),
			seoKeywords: z.array(z.string()).optional(),
			leadMagnetUrl: z.string().optional(),
			ctaText: z.string().optional(),
		}),
});

const authors = defineCollection({
	loader: glob({ base: './src/content/authors', pattern: '**/*.{md,mdx,json}' }),
	schema: ({ image }) => z.object({
		name: z.string(),
		bio: z.string().optional(),
		avatar: z.optional(image()),
		twitter: z.string().url().optional(),
		linkedin: z.string().url().optional()
	})
});

export const collections = { blog, authors };
