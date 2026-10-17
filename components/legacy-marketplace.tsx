'use client';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { legacyMarketplaceHref } from '@/lib/location-navigation';

export function LegacyMarketplace() {
    const router = useRouter();
    const search = useSearchParams().toString();
    useEffect(() => {
        const visit = () => {
            const destination = legacyMarketplaceHref(window.location.href);
            if (destination) router.replace(destination);
        };
        visit();
        window.addEventListener('hashchange', visit);
        return () => window.removeEventListener('hashchange', visit);
    }, [router, search]);
    return null;
}
