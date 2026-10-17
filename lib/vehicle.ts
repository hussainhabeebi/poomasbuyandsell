export const VEHICLE_MIN_YEAR = 1900;
// Generous enough for high-mileage commercial vehicles, while rejecting data-entry mistakes.
export const VEHICLE_MAX_MILEAGE = 10_000_000;
export function vehicleMaxYear(now = new Date()) { return now.getUTCFullYear() + 1; }

export function vehicleSpecIssues(specs: Record<string, string>, now = new Date()) {
    const issues: { field: string; message: string }[] = [];
    for (const [field, limit] of [['Make', 60], ['Model', 90]] as const) {
        const value = (specs[field] || '').trim();
        if (!value || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
            issues.push({ field, message: `Enter a vehicle ${field.toLowerCase()} (1–${limit} characters).` });
        }
    }
    // Keep optional fields optional, but never coerce exponents, units or hex into numbers.
    const year = (specs.Year || '').trim();
    if (year && (!/^\d{4}$/.test(year) || Number(year) < VEHICLE_MIN_YEAR || Number(year) > vehicleMaxYear(now))) {
        issues.push({ field: 'Year', message: `Enter a four-digit model year from ${VEHICLE_MIN_YEAR} to ${vehicleMaxYear(now)}.` });
    }
    const mileage = (specs.Mileage || '').trim();
    if (mileage && (!/^\d+$/.test(mileage) || !Number.isSafeInteger(Number(mileage)) || Number(mileage) > VEHICLE_MAX_MILEAGE)) {
        issues.push({ field: 'Mileage', message: `Enter mileage as whole kilometres from 0 to ${VEHICLE_MAX_MILEAGE.toLocaleString('en-AE')}.` });
    }
    return issues;
}
