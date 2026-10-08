'use client';
export default function ErrorPage({ reset }: {
    reset: () => void;
}) { return <div className="not-found"><h1>Let’s try that again.</h1><p>This page could not be loaded. Please retry in a moment.</p><button className="button primary" onClick={reset}>Try again</button></div>; }
