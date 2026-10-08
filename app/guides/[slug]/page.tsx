import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GUIDES, SITE_URL } from '@/lib/catalog';
import { meta, jsonLd } from '@/lib/pages';
export async function generateMetadata({ params }: {
    params: Promise<{
        slug: string;
    }>;
}) { const { slug } = await params; const g = GUIDES.find(x => x.slug === slug); return meta(g?.title || 'Guide Not Found', g?.description || 'This guide is unavailable.', `/guides/${slug}`, !g); }
export default async function Page({ params }: {
    params: Promise<{
        slug: string;
    }>;
}) { const { slug } = await params; const g = GUIDES.find(x => x.slug === slug); if (!g)
    notFound(); return <article className="article"><div className="breadcrumbs"><Link href="/guides">Buyer & seller guides</Link><span>/</span><span>{g.category}</span></div><span className="eyebrow">{g.category}</span><h1>{g.title}</h1><p className="intro">{g.description}</p>{g.sections.map(([title, text]) => <section key={title}><h2>{title}</h2><p>{text}</p></section>)}<div className="article-cta"><h2>Ready to explore?</h2><p>Find a listing, ask questions and take the next step at your own pace.</p><Link className="button primary" href={g.category === 'VEHICLES' ? '/vehicles' : g.category === 'PROPERTY' ? '/properties' : '/sell'}>{g.category === 'SELLER GUIDE' ? 'Post your listing' : 'Explore listings'}</Link></div><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({ '@context': 'https://schema.org', '@type': 'Article', headline: g.title, description: g.description, author: { '@type': 'Organization', name: 'Poomas Buy & Sell' }, mainEntityOfPage: `${SITE_URL}/guides/${slug}` }) }}/></article>; }
