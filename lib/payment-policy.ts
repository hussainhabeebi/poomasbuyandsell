// Keep the existing website-ad classification and stored package identifiers.
// Eligibility does not approve an advertising placement, price or duration.
export const WEBSITE_AD_PACKAGE_ID = 'boost';

export function isWebsiteAdPackage(value: unknown): boolean {
    return value === WEBSITE_AD_PACKAGE_ID;
}
