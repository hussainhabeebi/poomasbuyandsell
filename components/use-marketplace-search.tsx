'use client';

import { useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { marketplaceSearchSnapshot, subscribeMarketplaceUrl } from '@/lib/marketplace-url';

export function useMarketplaceSearchParams() {
    // Keep the request snapshot for SSR/hydration and subscribe to framework
    // route changes as well as our shallow updates and native Back/Forward.
    const serverSearch = useSearchParams().toString();
    const search = useSyncExternalStore(subscribeMarketplaceUrl, marketplaceSearchSnapshot, () => serverSearch);
    return new URLSearchParams(search);
}
