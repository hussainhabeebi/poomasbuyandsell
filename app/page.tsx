import { Welcome } from '@/components/welcome';
import { Home } from '@/components/marketplace';
import { LegacyMarketplace } from '@/components/legacy-marketplace';
import { inventory, viewer, meta } from '@/lib/pages';
import { legacyMarketplaceHref } from '@/lib/location-navigation';
export const dynamic = 'force-dynamic';
type Search = Record<string, string | string[] | undefined>;
function legacyDestination(search: Search) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
    return legacyMarketplaceHref(`/?${params}`);
}
export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }) {
    return legacyDestination(await searchParams)
        ? meta('UAE Commercial Properties & Vehicles', 'Browse commercial properties for sale and rent, and vehicles for sale across the UAE.', '/marketplace')
        : meta('Choose Your Emirate', 'Choose your emirate to discover commercial properties and vehicles on Poomas Buy & Sell. Browse Dubai, Abu Dhabi and all seven UAE emirates.', '/');
}
export default async function Page({ searchParams }: { searchParams: Promise<Search> }) {
    // Legacy query searches remain usable even without JavaScript. The client
    // replaces their address with /marketplace while retaining the original hash.
    if (legacyDestination(await searchParams)) {
        const [data, v] = await Promise.all([inventory(), viewer()]);
        return <><LegacyMarketplace/><Home {...data} viewer={v}/></>;
    }
    return <><LegacyMarketplace/><Welcome/></>;
}
