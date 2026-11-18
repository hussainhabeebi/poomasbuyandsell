'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, FileText, LoaderCircle, Lock, Plus, Search, SlidersHorizontal, Upload, X } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { Role } from '@/lib/crm/constants';
import { CRM_CATEGORIES, EMIRATES, SOURCES } from '@/lib/crm/constants';
import { can, restrictedFields, writableFields, type EntityType } from '@/lib/crm/permissions';
import { isPublicListing } from '@/lib/crm/visibility';
import { DEFAULTS, FORM_FIELDS, LABELS, STATUS_OPTIONS, aed, type Field } from './fields';
import styles from './crm.module.css';

type Row = Record<string, unknown>;
type Staff = { email: string; name: string; role: string; active: number; fromAdminEmails?: boolean };
type Duplicate = { type: EntityType; id: string; code: string; name: string };
type Tab = 'overview' | EntityType | 'team';
const TABS: { id: Tab; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'buyer', label: 'Buyers' }, { id: 'seller', label: 'Sellers' }, { id: 'listing', label: 'Listings' }, { id: 'team', label: 'Team' }];
const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', sales: 'Sales staff', readonly: 'Read-only' };

async function call(path: string, payload?: unknown) {
    const res = await fetch(path, payload instanceof FormData ? { method: 'POST', body: payload } : payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : { cache: 'no-store' });
    let data: Row = {};
    try {
        data = await res.json() as Row;
    }
    catch { /* non-JSON error */ }
    return { ok: res.ok, status: res.status, data };
}
const str = (v: unknown) => v == null ? '' : String(v);
const errorOf = (data: Row) => str(data.error) || 'Something went wrong. Please try again.';

const isRecordTab = (t: unknown): t is EntityType => t === 'buyer' || t === 'seller' || t === 'listing';
export function CrmApp({ role, email, initialTab, initialId }: { role: Role; email: string; initialTab?: string; initialId?: string }) {
    const [tab, setTab] = useState<Tab>(() => TABS.some(x => x.id === initialTab) ? initialTab as Tab : 'overview');
    const [open, setOpen] = useState<{ type: EntityType; id: string | null } | null>(() => initialId && isRecordTab(initialTab) ? { type: initialTab, id: initialId } : null);
    const [staff, setStaff] = useState<Staff[]>([]);
    const [version, setVersion] = useState(0);
    const loadStaff = useCallback(async () => { const r = await call('/api/crm/staff'); if (r.ok) setStaff(r.data.staff as Staff[]); }, []);
    useEffect(() => { let live = true; void call('/api/crm/staff').then(r => { if (live && r.ok) setStaff(r.data.staff as Staff[]); }); return () => { live = false; }; }, []);
    const go = (t: Tab) => { setTab(t); window.history.replaceState(null, '', `/admin/crm?tab=${t}`); };
    const openRecord = (type: EntityType, id: string | null) => { setTab(type); setOpen({ type, id }); window.history.replaceState(null, '', `/admin/crm?tab=${type}${id ? `&id=${id}` : ''}`); };
    const close = () => { setOpen(null); window.history.replaceState(null, '', `/admin/crm?tab=${tab}`); };
    return <div className={`container page-space ${styles.crm}`}>
        <div className={styles.heading}>
            <div><span className="eyebrow">POOMAS FZE LLC · BUSINESS FOR SALE CRM</span><h1>CRM</h1><p>Signed in as {email} · {ROLE_LABEL[role]}</p></div>
            {role === 'admin' && <Link className="button outline small" href="/admin">Marketplace review</Link>}
        </div>
        <nav className={styles.tabs} aria-label="CRM sections">{TABS.map(t => <button key={t.id} className={tab === t.id ? styles.tabActive : undefined} aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>{t.label}</button>)}</nav>
        {tab === 'overview' && <Overview key={version} go={go} />}
        {isRecordTab(tab) && <RecordList key={`${tab}-${version}`} type={tab} role={role} staff={staff} onOpen={id => openRecord(tab, id)} />}
        {tab === 'team' && <TeamPanel role={role} email={email} staff={staff} reload={loadStaff} />}
        <Sheet open={!!open} onOpenChange={o => { if (!o) close(); }}>
            <SheetContent side="right" className={styles.sheet}>
                {open && <RecordEditor key={`${open.type}-${open.id ?? 'new'}`} type={open.type} id={open.id} role={role} staff={staff} onSaved={(id) => { setVersion(v => v + 1); openRecord(open.type, id); }} openRecord={openRecord} />}
            </SheetContent>
        </Sheet>
    </div>;
}

function Overview({ go }: { go: (t: Tab) => void }) {
    const [totals, setTotals] = useState<Row | null>(null), [error, setError] = useState('');
    useEffect(() => { void call('/api/crm/records?totals=1').then(r => r.ok ? setTotals(r.data.totals as Row) : setError(errorOf(r.data))); }, []);
    if (error) return <p className="error notice">{error}</p>;
    const cards: [string, unknown, Tab][] = [['Total buyers', totals?.buyers, 'buyer'], ['Total sellers', totals?.sellers, 'seller'], ['Active listings', totals?.activeListings, 'listing'], ['New enquiries', totals?.newEnquiries, 'buyer'], ['Possible duplicates', totals?.possibleDuplicates, 'buyer']];
    return <>
        <div className={styles.stats}>{cards.map(([label, value, t]) => <button key={label} onClick={() => go(t)}><strong>{totals ? str(value ?? 0) : '…'}</strong><span>{label}</span></button>)}</div>
        <div className={styles.note}><p><strong>Public enquiry forms</strong> create records here automatically with status New and source Website.</p><p><Link className="text-link" href="/enquiry/buyer">Buyer enquiry form</Link> · <Link className="text-link" href="/enquiry/seller">Seller enquiry form</Link> · <Link className="text-link" href="/businesses-for-sale">Public business listings</Link></p></div>
    </>;
}

const FILTER_KEYS = ['q', 'status', 'category', 'emirate', 'area', 'min', 'max', 'source', 'assigned_to', 'follow_up_from', 'follow_up_to', 'duplicates'];
function RecordList({ type, role, staff, onOpen }: { type: EntityType; role: Role; staff: Staff[]; onOpen: (id: string | null) => void }) {
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [applied, setApplied] = useState<Record<string, string>>({});
    const [page, setPage] = useState(0), [more, setMore] = useState(false), [showMore, setShowMore] = useState(false);
    const [data, setData] = useState<{ records: Row[]; total: number } | null>(null), [error, setError] = useState('');
    useEffect(() => {
        const qs = new URLSearchParams({ type, page: String(page) });
        for (const [k, v] of Object.entries(applied)) if (v) qs.set(k, v);
        let live = true;
        void call(`/api/crm/records?${qs}`).then(r => { if (!live) return; if (r.ok) { setData({ records: r.data.records as Row[], total: Number(r.data.total) }); setMore(!!r.data.more); setError(''); } else setError(errorOf(r.data)); });
        return () => { live = false; };
    }, [type, page, applied]);
    const set = (k: string, v: string) => setFilters(f => ({ ...f, [k]: v }));
    const submit = (e: React.FormEvent) => { e.preventDefault(); setPage(0); setApplied(Object.fromEntries(Object.entries(filters).filter(([k, v]) => v && FILTER_KEYS.includes(k)))); };
    const reset = () => { setFilters({}); setApplied({}); setPage(0); };
    const categoryLabel = type === 'seller' ? 'Business type' : 'Category';
    const priceLabel = type === 'buyer' ? 'Budget' : 'Asking price';
    return <section aria-label={LABELS[type].plural}>
        <form className={styles.searchForm} onSubmit={submit} role="search">
            <div className={styles.searchRow}>
                <label className={styles.searchInput}><Search size={17} aria-hidden="true" /><span className="sr-only">Search</span><input value={filters.q ?? ''} onChange={e => set('q', e.target.value)} placeholder={type === 'listing' ? 'Search by business name or LST- ID' : `Search by name, phone/WhatsApp or ${type === 'buyer' ? 'BUY-' : 'SEL-'} ID`} /></label>
                <select aria-label="Status" value={filters.status ?? ''} onChange={e => set('status', e.target.value)}><option value="">Any status</option>{STATUS_OPTIONS[type].map(s => <option key={s}>{s}</option>)}</select>
                <button type="button" className="filter-toggle" onClick={() => setShowMore(!showMore)} aria-expanded={showMore}><SlidersHorizontal size={15} /> Filters</button>
                <button className="button primary small" type="submit">Search</button>
                {can(role, 'write') && <button type="button" className="button outline small" onClick={() => onOpen(null)}><Plus size={16} /> New {LABELS[type].singular}</button>}
            </div>
            {showMore && <div className={styles.filters}>
                <label>{categoryLabel}<select value={filters.category ?? ''} onChange={e => set('category', e.target.value)}><option value="">Any</option>{CRM_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
                <label>Emirate<select value={filters.emirate ?? ''} onChange={e => set('emirate', e.target.value)}><option value="">Any</option>{EMIRATES.map(c => <option key={c}>{c}</option>)}</select></label>
                <label>Area<input value={filters.area ?? ''} onChange={e => set('area', e.target.value)} /></label>
                <label>{priceLabel} from (AED)<input inputMode="numeric" value={filters.min ?? ''} onChange={e => set('min', e.target.value)} /></label>
                <label>{priceLabel} to (AED)<input inputMode="numeric" value={filters.max ?? ''} onChange={e => set('max', e.target.value)} /></label>
                {type !== 'listing' && <label>Source<select value={filters.source ?? ''} onChange={e => set('source', e.target.value)}><option value="">Any</option>{SOURCES.map(c => <option key={c}>{c}</option>)}</select></label>}
                <label>Assigned staff<select value={filters.assigned_to ?? ''} onChange={e => set('assigned_to', e.target.value)}><option value="">Anyone</option>{staff.map(s => <option key={s.email} value={s.email}>{s.name}</option>)}</select></label>
                {type !== 'listing' && <><label>Follow-up from<input type="date" value={filters.follow_up_from ?? ''} onChange={e => set('follow_up_from', e.target.value)} /></label>
                    <label>Follow-up to<input type="date" value={filters.follow_up_to ?? ''} onChange={e => set('follow_up_to', e.target.value)} /></label>
                    <label className="checkbox-label"><input type="checkbox" checked={filters.duplicates === '1'} onChange={e => set('duplicates', e.target.checked ? '1' : '')} />Possible duplicates only</label></>}
                <button type="button" className="text-button" onClick={reset}>Clear filters</button>
            </div>}
        </form>
        {error && <p className="error notice">{error}</p>}
        {!data && !error && <div className="loading"><LoaderCircle className="spin" /> Loading…</div>}
        {data && <>
            <p className="result-count">{data.total} {data.total === 1 ? LABELS[type].singular : LABELS[type].plural.toLowerCase()}</p>
            {data.records.length ? <RecordTable type={type} rows={data.records} staff={staff} onOpen={onOpen} /> : <div className="empty-state"><h3>No records found</h3><p>Try different search terms or filters.</p></div>}
            {(page > 0 || more) && <div className={styles.pager}><button className="button outline small" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1}</span><button className="button outline small" disabled={!more} onClick={() => setPage(page + 1)}>Next</button></div>}
        </>}
    </section>;
}

function RecordTable({ type, rows, staff, onOpen }: { type: EntityType; rows: Row[]; staff: Staff[]; onOpen: (id: string) => void }) {
    const who = (e: unknown) => staff.find(s => s.email === e)?.name ?? (e ? str(e) : '—');
    const place = (r: Row) => [r.area, r.emirate].filter(Boolean).join(', ') || '—';
    const cols: [string, (r: Row) => React.ReactNode][] = type === 'buyer' ? [
        ['Name', r => r.name as string], ['Phone', r => r.restricted && (r.restricted as string[]).includes('phone') ? <Restricted /> : str(r.phone)], ['Category', r => str(r.category) || '—'], ['Location', place],
        ['Budget', r => `${aed(r.budget_min)} – ${aed(r.budget_max)}`], ['Assigned', r => who(r.assigned_to)], ['Follow-up', r => str(r.next_follow_up_date) || '—'],
    ] : type === 'seller' ? [
        ['Contact', r => str(r.contact_name)], ['Business', r => [r.business_name, r.business_type].filter(Boolean).join(' · ') || '—'], ['Location', place],
        ['Asking price', r => aed(r.asking_price)], ['Verification', r => str(r.verification_status)], ['Assigned', r => who(r.assigned_to)],
    ] : [
        ['Business', r => str(r.business_name)], ['Seller', r => str(r.seller_code)], ['Category', r => str(r.category)], ['Location', place], ['Asking price', r => aed(r.asking_price)],
        ['Public', r => isPublicListing(r) ? 'Yes' : 'No'], ['Assigned', r => who(r.assigned_to)],
    ];
    return <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>ID</th>{cols.map(([h]) => <th key={h}>{h}</th>)}<th>Status</th></tr></thead>
        <tbody>{rows.map(r => <tr key={str(r.id)}>
            <td data-label="ID"><button className={styles.codeButton} onClick={() => onOpen(str(r.id))}>{str(r.code)}</button>{r.duplicate_of ? <span className={styles.dupTag} title="Possible duplicate"><AlertTriangle size={12} /> Duplicate?</span> : null}</td>
            {cols.map(([h, f]) => <td key={h} data-label={h}>{f(r)}</td>)}
            <td data-label="Status"><span className="status">{str(r.status)}</span></td>
        </tr>)}</tbody>
    </table></div>;
}

const Restricted = () => <span className={styles.restricted}><Lock size={12} aria-hidden="true" /> Restricted</span>;

function toForm(type: EntityType, r: Row | null) {
    const out: Record<string, string> = { ...(r ? {} : DEFAULTS[type]) };
    if (r) for (const f of FORM_FIELDS[type]) out[f.key] = f.type === 'links' ? (Array.isArray(r[f.key]) ? (r[f.key] as string[]).join('\n') : '') : str(r[f.key]);
    return out;
}

function RecordEditor({ type, id, role, staff, onSaved, openRecord }: { type: EntityType; id: string | null; role: Role; staff: Staff[]; onSaved: (id: string) => void; openRecord: (t: EntityType, id: string | null) => void }) {
    const creating = !id;
    const [detail, setDetail] = useState<Row | null>(null), [form, setForm] = useState<Record<string, string>>(() => toForm(type, null));
    const initial = useRef<Record<string, string>>(toForm(type, null));
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const [duplicates, setDuplicates] = useState<Duplicate[]>([]), [needsConfirm, setNeedsConfirm] = useState(false);
    const apply = useCallback((r: Awaited<ReturnType<typeof call>>) => {
        if (!r.ok) { setError(errorOf(r.data)); return; }
        setDetail(r.data); const f = toForm(type, r.data.record as Row); setForm(f); initial.current = f;
    }, [type]);
    const fetchDetail = useCallback(() => call(`/api/crm/records?type=${type}&id=${encodeURIComponent(id ?? '')}`), [id, type]);
    const load = useCallback(async () => { if (id) apply(await fetchDetail()); }, [apply, fetchDetail, id]);
    useEffect(() => { if (!id) return; let live = true; void fetchDetail().then(r => { if (live) apply(r); }); return () => { live = false; }; }, [apply, fetchDetail, id]);
    const record = detail?.record as Row | undefined;
    const hidden = useMemo(() => new Set(creating ? restrictedFields(type, role).filter(f => !writableFields(type, role, [f], true).length) : (record?.restricted as string[] | undefined) ?? restrictedFields(type, role)), [creating, record, role, type]);
    const editable = can(role, 'write');
    const set = (k: string, v: string) => { setForm(f => ({ ...f, [k]: v })); if (k === 'phone') { setDuplicates([]); setNeedsConfirm(false); } };
    const checkPhone = async () => {
        const phone = form.phone?.trim();
        if (!phone || (!creating && phone === initial.current.phone)) return;
        const r = await call(`/api/crm/records?phoneCheck=${encodeURIComponent(phone)}`);
        if (r.ok) setDuplicates((r.data.duplicates as Duplicate[]).filter(d => !(d.type === type && d.id === id)));
    };
    const save = async (confirmDuplicate = false) => {
        setBusy(true); setError(''); setMessage('');
        const data: Row = {};
        for (const f of FORM_FIELDS[type]) {
            if (hidden.has(f.key)) continue;
            if (!creating && form[f.key] === initial.current[f.key]) continue;
            data[f.key] = form[f.key] ?? '';
        }
        const r = await call('/api/crm/records', creating ? { action: 'create', type, data, confirmDuplicate } : { action: 'update', type, id, data, confirmDuplicate });
        setBusy(false);
        if (r.status === 409) { setDuplicates(((r.data.details as Row)?.duplicates as Duplicate[]) ?? []); setNeedsConfirm(true); setError(errorOf(r.data)); return; }
        if (!r.ok) { setError(errorOf(r.data)); return; }
        setNeedsConfirm(false);
        if (creating) onSaved(str(r.data.id));
        else { setMessage(r.data.changed ? 'Changes saved.' : 'No changes to save.'); await load(); }
    };
    const title = creating ? `New ${LABELS[type].singular}` : `${str(record?.code)} · ${str(record?.name ?? record?.contact_name ?? record?.business_name)}`;
    return <div className={styles.editor}>
        <SheetHeader className={styles.sheetHeader}><SheetTitle>{title}</SheetTitle><SheetDescription>{creating ? 'The record ID is assigned automatically when you save.' : `Created ${str(record?.created_at).slice(0, 10)} · ${record?.created_via === 'web' ? 'Website enquiry' : 'Entered by staff'}`}</SheetDescription></SheetHeader>
        {!creating && !detail && !error && <div className="loading"><LoaderCircle className="spin" /> Loading…</div>}
        {(creating || detail) && <form className={styles.form} onSubmit={e => { e.preventDefault(); void save(false); }}>
            {!creating && !!detail?.duplicateOf && <div className={styles.warning}><AlertTriangle size={16} /> Possible duplicate of <button type="button" className="text-link" onClick={() => openRecord(type, str((detail.duplicateOf as Row).id))}>{str((detail.duplicateOf as Row).code)}</button>. Records are never merged automatically; review both before continuing.</div>}
            {duplicates.length > 0 && <div className={styles.warning} role="alert"><AlertTriangle size={16} /><div><strong>This phone number already exists:</strong><ul>{duplicates.map(d => <li key={d.id}><button type="button" className="text-link" onClick={() => openRecord(d.type, d.id)}>{d.code}</button> {d.name} ({d.type})</li>)}</ul>{needsConfirm && <button type="button" className="button outline small" disabled={busy} onClick={() => void save(true)}>Save anyway as a separate record</button>}</div></div>}
            <div className={styles.fieldGrid}>{FORM_FIELDS[type].map(f => <FieldInput key={f.key} field={f} value={form[f.key] ?? ''} onChange={v => set(f.key, v)} onBlur={f.key === 'phone' ? checkPhone : undefined} hidden={hidden.has(f.key)} disabled={!editable} staff={staff} sellerLabel={detail?.seller ? `${str((detail.seller as Row).code)} · ${str((detail.seller as Row).contact_name)}` : ''} />)}</div>
            {type === 'listing' && <p className="muted">A listing appears on the public website only when an administrator sets it to Active with documents verified, publishing authorized and a verified seller.{record ? ` Currently ${isPublicListing(record) ? 'public' : 'not public'}.` : ''}</p>}
            {error && <p className="error notice" role="alert">{error}</p>}
            {message && <p className="notice" role="status">{message}</p>}
            {editable && <div className={styles.actions}><button className="button primary" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : null}{creating ? `Create ${LABELS[type].singular}` : 'Save changes'}</button></div>}
        </form>}
        {!creating && detail && <RecordExtras type={type} id={id!} detail={detail} role={role} reload={load} openRecord={openRecord} />}
    </div>;
}

function FieldInput({ field: f, value, onChange, onBlur, hidden, disabled, staff, sellerLabel }: { field: Field; value: string; onChange: (v: string) => void; onBlur?: () => void; hidden: boolean; disabled: boolean; staff: Staff[]; sellerLabel: string }) {
    const cls = f.wide ? styles.wide : undefined;
    if (hidden) return <div className={cls}><span className={styles.label}>{f.label}</span><Restricted /></div>;
    const label = <>{f.label}{f.required && <span aria-hidden="true"> *</span>}</>;
    if (f.type === 'seller') return <div className={cls}><SellerPicker value={value} initialLabel={sellerLabel} onChange={onChange} disabled={disabled} /></div>;
    if (f.type === 'select' || f.type === 'staff') return <label className={cls}>{label}<select value={value} onChange={e => onChange(e.target.value)} disabled={disabled} required={f.required}>
        <option value="">{f.type === 'staff' ? 'Unassigned' : 'Not set'}</option>
        {f.type === 'staff' ? staff.filter(s => s.active && s.role !== 'readonly').map(s => <option key={s.email} value={s.email}>{s.name}</option>) : f.options!.map(o => <option key={o}>{o}</option>)}
    </select></label>;
    if (f.type === 'textarea' || f.type === 'links') return <label className={cls}>{label}<textarea value={value} onChange={e => onChange(e.target.value)} disabled={disabled} rows={f.type === 'links' ? 3 : 4} /></label>;
    return <label className={cls}>{label}<input type={f.type === 'money' ? 'text' : f.type} inputMode={f.type === 'money' ? 'decimal' : f.type === 'tel' ? 'tel' : undefined} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} disabled={disabled} required={f.required} autoComplete="off" /></label>;
}

function SellerPicker({ value, initialLabel, onChange, disabled }: { value: string; initialLabel: string; onChange: (v: string) => void; disabled: boolean }) {
    const [q, setQ] = useState(''), [results, setResults] = useState<Row[]>([]), [picked, setLabel] = useState('');
    const label = picked || initialLabel;
    const search = async () => { const r = await call(`/api/crm/records?type=seller&q=${encodeURIComponent(q)}`); if (r.ok) setResults(r.data.records as Row[]); };
    return <div className={styles.picker}>
        <span className={styles.label}>Seller *</span>
        {value && <p className={styles.picked}>{label || 'Selected seller'}</p>}
        {!disabled && <div className={styles.pickerRow}><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} placeholder="Search sellers by name, phone or SEL- ID" aria-label="Search sellers" /><button type="button" className="button outline small" onClick={() => void search()}>Find</button></div>}
        {results.length > 0 && <ul className={styles.pickerList}>{results.map(r => <li key={str(r.id)}><button type="button" onClick={() => { onChange(str(r.id)); setLabel(`${str(r.code)} · ${str(r.contact_name)}`); setResults([]); }}>{str(r.code)} · {str(r.contact_name)}{r.business_name ? ` · ${str(r.business_name)}` : ''}</button></li>)}</ul>}
    </div>;
}

function RecordExtras({ type, id, detail, role, reload, openRecord }: { type: EntityType; id: string; detail: Row; role: Role; reload: () => Promise<void>; openRecord: (t: EntityType, id: string | null) => void }) {
    const [uploading, setUploading] = useState(false), [error, setError] = useState('');
    const upload = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true); setError('');
        const form = new FormData(); form.append('entityType', type); form.append('entityId', id); form.append('file', file);
        const r = await call('/api/crm/documents', form);
        setUploading(false);
        if (!r.ok) setError(errorOf(r.data)); else await reload();
    };
    const listings = detail.listings as Row[] | undefined, seller = detail.seller as Row | undefined, documents = detail.documents as Row[] | undefined, audit = detail.audit as Row[] | undefined;
    return <div className={styles.extras}>
        {seller && <section><h3>Seller</h3><button className="text-link" onClick={() => openRecord('seller', str(seller.id))}>{str(seller.code)} · {str(seller.contact_name)}</button> <span className="muted">({str(seller.verification_status)})</span></section>}
        {listings && <section><h3>Listings</h3>{listings.length ? <ul>{listings.map(l => <li key={str(l.id)}><button className="text-link" onClick={() => openRecord('listing', str(l.id))}>{str(l.code)}</button> {str(l.business_name)} <span className="status">{str(l.status)}</span></li>)}</ul> : <p className="muted">No listings yet.</p>}{can(role, 'write') && <button className="button outline small" onClick={() => openRecord('listing', null)}><Plus size={15} /> New listing</button>}</section>}
        {type !== 'buyer' && <section><h3>Confidential documents</h3>
            {documents ? <>{documents.length ? <ul>{documents.map(d => <li key={str(d.id)}><FileText size={14} /> <a className="text-link" href={`/api/crm/documents/${str(d.id)}`}>{str(d.file_name)}</a> <span className="muted">{Math.ceil(Number(d.size) / 1024)} KB · {str(d.created_at).slice(0, 10)}</span></li>)}</ul> : <p className="muted">No documents uploaded.</p>}
                <label className={styles.upload}><Upload size={15} /> {uploading ? 'Uploading…' : 'Upload PDF, JPG or PNG (max 10 MB)'}<input type="file" accept="application/pdf,image/jpeg,image/png" disabled={uploading} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
                {error && <p className="error">{error}</p>}</> : <Restricted />}
        </section>}
        {audit && <section><h3>Change history</h3><ul className={styles.audit}>{audit.map((a, i) => <li key={i}><strong>{str(a.action).replace('_', ' ')}</strong> by {str(a.actor_email)} · {str(a.created_at).replace('T', ' ').slice(0, 16)} UTC<br /><span className="muted">{Object.keys(a.changes as Row).join(', ') || '—'}</span></li>)}</ul></section>}
    </div>;
}

function TeamPanel({ role, email, staff, reload }: { role: Role; email: string; staff: Staff[]; reload: () => Promise<void> }) {
    const blank = { email: '', name: '', role: 'sales', active: true };
    const [form, setForm] = useState(blank), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
    const admin = can(role, 'manageStaff');
    const submit = async (e: React.FormEvent) => {
        e.preventDefault(); setBusy(true); setError(''); setMessage('');
        const r = await call('/api/crm/staff', form);
        setBusy(false);
        if (!r.ok) { setError(errorOf(r.data)); return; }
        setMessage('Team member saved.'); setForm(blank); await reload();
    };
    return <section className={styles.team}>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th>{admin && <th />}</tr></thead>
            <tbody>{staff.map(s => <tr key={s.email}><td data-label="Name">{s.name}</td><td data-label="Email">{s.email}</td><td data-label="Role">{ROLE_LABEL[s.role] ?? s.role}{s.fromAdminEmails ? ' (ADMIN_EMAILS)' : ''}</td><td data-label="Access">{s.active ? 'Active' : 'Disabled'}</td>
                {admin && <td>{!s.fromAdminEmails && s.email !== email && <button className="text-button" onClick={() => setForm({ email: s.email, name: s.name, role: s.role, active: !!s.active })}>Edit</button>}</td>}</tr>)}</tbody></table></div>
        {admin ? <form className={`form-card ${styles.teamForm}`} onSubmit={submit}>
            <h3>Add or update a team member</h3>
            <p className="muted">Staff sign in with their Google account. Use the exact Google email address.</p>
            <div className={styles.fieldGrid}>
                <label>Google email<input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
                <label>Name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
                <label>Role<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="sales">Sales staff</option><option value="readonly">Read-only</option><option value="admin">Administrator</option></select></label>
                <label className="checkbox-label"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />Access enabled</label>
            </div>
            {error && <p className="error notice">{error}</p>}{message && <p className="notice">{message}</p>}
            <div className={styles.actions}><button className="button primary" disabled={busy}>Save team member</button>{form.email && <button type="button" className="text-button" onClick={() => setForm(blank)}><X size={14} /> Clear</button>}</div>
        </form> : <p className="muted">Only administrators can manage team access.</p>}
    </section>;
}
