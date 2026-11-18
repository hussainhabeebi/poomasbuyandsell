'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { CONTACT_METHODS, CRM_CATEGORIES, EMIRATES, SELLER_RELATIONSHIP } from '@/lib/crm/constants';
declare global { interface Window { turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void } } }
type Kind = 'buyer' | 'seller';
export function PublicEnquiryForm({ kind, siteKey }: { kind: Kind; siteKey: string }) {
    const [token, setToken] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('');
    const widget = useRef<HTMLDivElement>(null), widgetId = useRef<string | null>(null);
    useEffect(() => {
        if (!siteKey) return;
        const render = () => {
            if (!widget.current || !window.turnstile || widgetId.current) return;
            widgetId.current = window.turnstile.render(widget.current, { sitekey: siteKey, callback: (t: string) => setToken(t), 'expired-callback': () => setToken(''), 'error-callback': () => setToken('') });
        };
        if (window.turnstile) { render(); return; }
        const src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        let script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
        if (!script) { script = document.createElement('script'); script.src = src; script.async = true; document.head.appendChild(script); }
        script.addEventListener('load', render);
        return () => script?.removeEventListener('load', render);
    }, [siteKey]);
    const submit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError('');
        const fd = new FormData(e.currentTarget), data: Record<string, unknown> = {};
        for (const [k, v] of fd.entries()) if (k !== 'website' && k !== 'cf-turnstile-response') data[k] = String(v);
        data.consent = fd.get('consent') === 'on';
        if (!token) { setError('Please complete the security check.'); return; }
        setBusy(true);
        try {
            const res = await fetch('/api/crm/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, data, turnstileToken: token, website: String(fd.get('website') || '') }) });
            const out = await res.json() as { error?: string; message?: string };
            if (!res.ok) throw new Error(out.error || 'Your enquiry could not be sent. Please try again.');
            setDone(out.message || 'Thank you. Our team will contact you shortly.');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Your enquiry could not be sent. Please try again.');
            setToken('');
            if (widgetId.current) window.turnstile?.reset(widgetId.current);
        }
        finally { setBusy(false); }
    };
    if (done) return <div className="form-card success-state" role="status"><CheckCircle2 size={40} /><h3>Enquiry received</h3><p>{done}</p></div>;
    return <form className="form-card listing-form" onSubmit={submit} noValidate={false}>
        <div className="field-grid">
            <label>{kind === 'buyer' ? 'Your name' : 'Owner / contact name'} *<input name={kind === 'buyer' ? 'name' : 'contact_name'} required minLength={2} maxLength={100} autoComplete="name" /></label>
            <label>Phone / WhatsApp *<input name="phone" type="tel" required maxLength={30} autoComplete="tel" placeholder="+971 50 123 4567" /></label>
            <label className="span-two">Email (optional)<input name="email" type="email" maxLength={160} autoComplete="email" /></label>
            {kind === 'seller' && <>
                <label>Business name *<input name="business_name" required minLength={2} maxLength={140} /></label>
                <label>Business type *<select name="business_type" required defaultValue=""><option value="" disabled>Choose a type</option>{CRM_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
            </>}
            {kind === 'buyer' && <label className="span-two">Business category *<select name="category" required defaultValue=""><option value="" disabled>Choose a category</option>{CRM_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>}
            <label>{kind === 'buyer' ? 'Preferred emirate' : 'Emirate'} *<select name="emirate" required defaultValue=""><option value="" disabled>Choose an emirate</option>{EMIRATES.map(c => <option key={c}>{c}</option>)}</select></label>
            <label>{kind === 'buyer' ? 'Preferred area' : 'Area'}<input name="area" maxLength={100} /></label>
            {kind === 'buyer' ? <>
                <label>Minimum budget (AED)<input name="budget_min" inputMode="decimal" /></label>
                <label>Maximum budget (AED)<input name="budget_max" inputMode="decimal" /></label>
                <label className="span-two">Preferred contact method *<select name="contact_method" required defaultValue="WhatsApp">{CONTACT_METHODS.map(c => <option key={c}>{c}</option>)}</select></label>
                <label className="span-two">Requirements *<textarea name="requirements" required minLength={10} maxLength={3000} placeholder="Type of business, size, features you need, timeline…" /></label>
            </> : <>
                <label>Asking price (AED)<input name="asking_price" inputMode="decimal" /></label>
                <label>Monthly rent (AED)<input name="monthly_rent" inputMode="decimal" /></label>
                <label>Estimated monthly profit (AED, optional)<input name="estimated_monthly_profit" inputMode="decimal" /></label>
                <label>You are the *<select name="relationship" required defaultValue=""><option value="" disabled>Choose one</option>{SELLER_RELATIONSHIP.map(c => <option key={c}>{c}</option>)}</select></label>
                <label className="span-two">Business details *<textarea name="business_details" required minLength={10} maxLength={3000} placeholder="Licence type, years operating, staff, what is included in the sale…" /></label>
            </>}
        </div>
        <label aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
        <label className="checkbox-label"><input type="checkbox" name="consent" required />I agree that Poomas FZE LLC may contact me by phone, WhatsApp or email about this enquiry, and I have read the privacy policy.</label>
        {kind === 'seller' && <small>Do not upload or send confidential documents through this form. Our team will request verification documents separately. Listings are published only after owner or authorized-representative verification.</small>}
        {siteKey ? <div ref={widget} /> : <p className="error notice">The enquiry form is temporarily unavailable. Please contact us on WhatsApp.</p>}
        {error && <p className="error notice" role="alert">{error}</p>}
        <button className="button primary full" disabled={busy || !siteKey} type="submit">{busy ? <LoaderCircle className="spin" size={17} /> : null}Send {kind} enquiry</button>
    </form>;
}
