import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';

export async function GET(context) {
	const posts = await getCollection('blog', ({ data }) => !data.draft);
	
	// Sort by pubDate descending
	posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site || 'https://pulsedeck.de/magazin',
		items: posts.map((post) => ({
			title: post.data.title,
			pubDate: post.data.pubDate,
			description: post.data.summary || post.data.description,
			link: `/magazin/blog/${post.id}/`,
			customData: post.data.category ? `<category>${post.data.category}</category>` : '',
		})),
		customData: `<language>de-de</language>`,
	});
}
