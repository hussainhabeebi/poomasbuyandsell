// Phone normalisation for CRM duplicate detection. UAE numbers become E.164
// (+9715XXXXXXXX); other international numbers must include a country code.
export function normalizePhone(input: string): string | null {
    const raw = String(input ?? '').trim();
    if (!raw || !/^[+0-9\s().-]+$/.test(raw))
        return null;
    let digits = raw.replace(/[^0-9]/g, '');
    const plus = raw.startsWith('+');
    if (!plus && digits.startsWith('00'))
        digits = digits.slice(2);
    else if (!plus && digits.startsWith('0') && (digits.length === 9 || digits.length === 10))
        digits = '971' + digits.slice(1);
    else if (!plus && /^5[0-9]{8}$/.test(digits))
        digits = '971' + digits;
    else if (!plus && !digits.startsWith('971'))
        return null;
    if (digits.startsWith('9710'))
        digits = '971' + digits.slice(4);
    if (digits.length < 8 || digits.length > 15 || digits.startsWith('0'))
        return null;
    if (digits.startsWith('971') && (digits.length < 11 || digits.length > 12))
        return null;
    return '+' + digits;
}
