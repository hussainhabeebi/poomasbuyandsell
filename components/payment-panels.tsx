'use client';
import { useEffect, useState } from 'react';
import { CHECKOUT_ORDER_KEY, paymentStatusCopy } from '../lib/payment-display';
import type { SellerPaymentStatus } from '../lib/payment-status';
import { PACKAGES, money } from '../lib/catalog';
import styles from './payment-panels.module.css';

export function PaymentReturn({ promotion, onStatus }: { promotion: string; onStatus: (status: SellerPaymentStatus) => void }) {
    const [id, setId] = useState(promotion), [status, setStatus] = useState<SellerPaymentStatus | null>(null);
    const [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(false);
    useEffect(() => {
        let selected = promotion;
        try { selected ||= sessionStorage.getItem(CHECKOUT_ORDER_KEY) || ''; } catch { /* Storage may be disabled. */ }
        setId(selected);
    }, [promotion]);
    useEffect(() => {
        setStatus(null); setError('');
        if (!id) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        let checks = 0;
        async function check() {
            setLoading(true);
            try {
                const response = await fetch(`/api/promotions/payment-status?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal });
                const result = await response.json() as SellerPaymentStatus & { error?: string };
                if (!response.ok) throw new Error(result.error || 'Payment status could not be loaded.');
                if (controller.signal.aborted) return;
                const next = result as SellerPaymentStatus;
                setStatus(next); setError(''); onStatus(next);
                if (paymentStatusCopy(next.status, next.verified, next.lastAttempt).pending && ++checks < 6) timer = setTimeout(check, 5000);
            } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
            finally { if (!controller.signal.aborted) setLoading(false); }
        }
        void check();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [id, refresh, onStatus]);
    const copy = status && paymentStatusCopy(status.status, status.verified, status.lastAttempt);
    return <section className={styles.panel} aria-labelledby="payment-return-title">
        <span className="eyebrow">YOUR PROMOTION PAYMENT</span>
        <div aria-live="polite" aria-atomic="true">
            <h2 id="payment-return-title">{copy?.title || (id ? 'Checking payment status' : 'Welcome back from checkout')}</h2>
            {status && <><h3>{PACKAGES.find(p => p.id === status.packageId)?.name || 'Promotion'} · {status.title}</h3>
                <p>Request {status.id.slice(0, 8)}{status.amount !== null && ` · ${money(status.amount)}`}</p></>}
            <p>{copy?.message || 'Returning from Nomod is not proof of payment. Review the verified status of your promotion here.'}</p>
            {!promotion && id && <p>This older return link uses the most recent checkout saved in this tab. Confirm the listing and request number; other promotions are listed below.</p>}
            {!id && <p>Open the Promotions section below to find your request. Older checkout links may not identify a specific promotion.</p>}
            {error && <p className="error" role="alert">{error}</p>}
        </div>
        {id && <button type="button" className="button outline" disabled={loading} onClick={() => setRefresh(x => x + 1)}>{loading ? 'Checking…' : 'Refresh payment status'}</button>}
        <small>Automatic checks stop after six updates. Refresh checks saved records only; it never creates a payment or contacts Nomod.</small>
    </section>;
}
interface RecoveryEvent {
    id: string; order_id: string | null; type: string; outcome: string; received_at: string;
    order_status: string | null; stored_link_id: string | null; title: string | null; attempts: number; last_attempt_at: string | null;
}
interface RecoveryAttempt { order_id: string; title: string; state: string; attempt_id: string }
interface Overview {
    enabled: boolean; verificationLimit: number; cooldownMs: number; batchSize: number;
    events: RecoveryEvent[]; attempts: RecoveryAttempt[]; hasMore: boolean; page: number;
}
export function NomodRecoveryPanel() {
    const [data, setData] = useState<Overview | null>(null), [page, setPage] = useState(0);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
    const [links, setLinks] = useState<Record<string, string>>({});
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setData(null); setError('');
        fetch(`/api/nomod/reconcile?page=${page}`, { cache: 'no-store', signal: controller.signal })
            .then(async response => { const result = await response.json() as Overview & { error?: string }; if (!response.ok) throw new Error(result.error || 'Recovery information unavailable.'); return result; })
            .then(result => { if (!controller.signal.aborted) setData(result); })
            .catch(e => { if (!controller.signal.aborted) setError(e.message); });
        return () => controller.abort();
    }, [page, refresh]);
    async function reconcile(orderId: string, linkId?: string) {
        if (busy || !data?.enabled) return;
        setBusy(true); setError(''); setMessage('');
        try {
            const response = await fetch('/api/nomod/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: orderId, ...(linkId ? { linkId } : {}) }) });
            const result = await response.json() as { message: string; error?: string };
            if (!response.ok) throw new Error(result.error || 'Recovery failed.');
            setMessage(result.message); setRefresh(x => x + 1);
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
    }
    return <section className={styles.panel} aria-labelledby="nomod-recovery-title">
        <span className="eyebrow">OPERATOR REVIEW</span><h2 id="nomod-recovery-title">Nomod payment recovery</h2>
        <p>Review saved events and original checkout attempts. Recovery never creates a replacement link or delivers a promotion service.</p>
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {!data && !error && <p role="status">Loading recovery information…</p>}
        {data && <>
            {!data.enabled && <p role="status"><strong>Verification is disabled by release/configuration controls.</strong> Saved events remain visible; provider lookup and reconciliation cannot run.</p>}
            <p>At most {data.verificationLimit} provider checks per event, at least {data.cooldownMs / 1000} seconds apart. Each replay examines at most {data.batchSize} eligible events. Exhausted events require investigation; there is no reset button.</p>
            <h3>Unresolved or rejected events</h3>
            {!data.events.length && <p>No events on this page need review.</p>}
            <ul className={styles.list}>{data.events.map(e => {
                const exhausted = e.attempts >= data.verificationLimit;
                const cooling = !!e.last_attempt_at && Date.now() < Date.parse(e.last_attempt_at) + data.cooldownMs;
                const canReplay = !!e.order_id && (e.outcome !== 'pending_link' || !!e.stored_link_id) && !e.outcome.startsWith('rejected_') && !exhausted && !cooling;
                return <li key={e.id}><strong>{e.title || 'Unmatched promotion'}</strong><span>{e.type} · {e.outcome.replaceAll('_', ' ')}</span>
                    <small>Event {e.id} · Order {e.order_id || 'unmatched'} · {e.received_at}</small>
                    <span>{e.attempts}/{data.verificationLimit} checks{exhausted ? ' · Manual investigation required' : cooling ? ' · Cooldown active' : ''}</span>
                    {e.last_attempt_at && <small>Last provider check: {e.last_attempt_at}</small>}
                    {e.outcome === 'pending_link' && !e.stored_link_id && <span>Locate and adopt the original attempted link below; never create another link.</span>}
                    {canReplay && <button type="button" className="button outline" disabled={busy || !data.enabled} onClick={() => reconcile(e.order_id!)}>Replay pending events for this order</button>}
                </li>;
            })}</ul>
            <h3>Checkout attempts requiring link recovery</h3>
            {!data.attempts.length && <p>No unresolved link attempts on this page.</p>}
            <ul className={styles.list}>{data.attempts.map(a => <li key={a.order_id}><strong>{a.title}</strong><span>{a.state} · Order {a.order_id}</span>
                <small>Locate the original link in Nomod using attempt {a.attempt_id}. A missing search result is not permission to create a replacement.</small>
                <label>Original Nomod link UUID<input value={links[a.order_id] || ''} maxLength={36} autoComplete="off" onChange={e => setLinks(x => ({ ...x, [a.order_id]: e.target.value.trim() }))}/></label>
                <button type="button" className="button outline" disabled={busy || !data.enabled || !/^[a-f0-9-]{36}$/i.test(links[a.order_id] || '')} onClick={() => reconcile(a.order_id, links[a.order_id])}>Verify and adopt original link</button>
            </li>)}</ul>
            <div className={styles.actions}><button type="button" className="button outline" disabled={busy || page === 0} onClick={() => setPage(x => x - 1)}>Previous page</button>
                <span>Page {page + 1}</span><button type="button" className="button outline" disabled={busy || !data.hasMore} onClick={() => setPage(x => x + 1)}>Next page</button></div>
        </>}
        <button type="button" className="button outline" disabled={busy} onClick={() => setRefresh(x => x + 1)}>Refresh recovery information</button>
    </section>;
}
