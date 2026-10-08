import Link from 'next/link';
export default function NotFound() { return <div className="not-found"><span className="eyebrow">404 · NOT FOUND</span><h1>This opportunity has moved.</h1><p>The page or listing you’re looking for isn’t available.</p><Link className="button primary" href="/">Back to the marketplace</Link></div>; }
