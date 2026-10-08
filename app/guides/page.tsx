import Link from 'next/link';
import { GUIDES } from '@/lib/catalog';
import { meta } from '@/lib/pages';
export const metadata = meta('UAE Property, Vehicle & Seller Guides', 'Practical guides for commercial property viewings, used vehicle buying and preparing a listing for Instagram promotion.', '/guides');
export default function Page() { return <div className="container"><div className="guide-heading"><span className="eyebrow">A LITTLE KNOW-HOW GOES A LONG WAY</span><h1>Make an informed move.</h1><p>Useful questions. Better preparation. Clearer conversations.</p></div><div className="guide-grid">{GUIDES.map((g, i) => <Link className="guide-card" key={g.slug} href={`/guides/${g.slug}`}><span className="guide-number">0{i + 1}</span><span className="eyebrow">{g.category}</span><h2>{g.title}</h2><p>{g.description}</p><span className="text-link">Read the guide</span></Link>)}</div></div>; }
