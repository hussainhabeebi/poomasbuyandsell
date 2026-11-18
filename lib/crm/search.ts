// Builds a parameterised WHERE clause from whitelisted search filters.
// Column names never come from user input.
import { ENTITIES } from './entities.ts';
import type { EntityType } from './permissions.ts';
import { normalizePhone } from './phone.ts';
export type SearchFilters = Partial<Record<'q' | 'category' | 'emirate' | 'area' | 'min' | 'max' | 'source' | 'status' | 'assigned_to' | 'follow_up_from' | 'follow_up_to' | 'seller_id' | 'duplicates', string>>;
export const SEARCH_KEYS = ['q', 'category', 'emirate', 'area', 'min', 'max', 'source', 'status', 'assigned_to', 'follow_up_from', 'follow_up_to', 'seller_id', 'duplicates'] as const;
const like = (v: string) => '%' + v.replace(/[\\%_]/g, m => '\\' + m) + '%';
const date = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const num = (v: string) => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) ? n : null; };
export function buildSearch(type: EntityType, f: SearchFilters, alias = ''): { where: string; binds: unknown[] } {
    const def = ENTITIES[type], parts: string[] = [], binds: unknown[] = [], a = alias ? alias + '.' : '';
    const q = (f.q ?? '').trim().slice(0, 100);
    if (q) {
        const or: string[] = [`${a}code = ?`];
        binds.push(q.toUpperCase());
        const phone = def.hasPhone && /^[+0-9\s().-]{7,}$/.test(q) ? normalizePhone(q) : null;
        if (phone) {
            or.push(`${a}phone_normalized = ?`);
            binds.push(phone);
        }
        for (const c of def.nameColumns) {
            or.push(`${a}${c} LIKE ? ESCAPE '\\'`);
            binds.push(like(q));
        }
        parts.push('(' + or.join(' OR ') + ')');
    }
    const eq = (key: keyof SearchFilters, column: string) => { const v = (f[key] ?? '').trim(); if (v) {
        parts.push(`${a}${column} = ?`);
        binds.push(v.slice(0, 160));
    } };
    eq('category', def.categoryColumn);
    eq('emirate', 'emirate');
    eq('status', 'status');
    eq('assigned_to', 'assigned_to');
    if (type !== 'listing')
        eq('source', 'source');
    if (type === 'listing')
        eq('seller_id', 'seller_id');
    const area = (f.area ?? '').trim();
    if (area) {
        parts.push(`${a}area LIKE ? ESCAPE '\\'`);
        binds.push(like(area.slice(0, 100)));
    }
    const min = num(f.min ?? ''), max = num(f.max ?? '');
    if (def.priceRange === 'budget') {
        if (min !== null) {
            parts.push(`(${a}budget_max IS NULL OR ${a}budget_max >= ?)`);
            binds.push(min);
        }
        if (max !== null) {
            parts.push(`(${a}budget_min IS NULL OR ${a}budget_min <= ?)`);
            binds.push(max);
        }
    }
    else {
        if (min !== null) {
            parts.push(`${a}asking_price >= ?`);
            binds.push(min);
        }
        if (max !== null) {
            parts.push(`${a}asking_price <= ?`);
            binds.push(max);
        }
    }
    if (type !== 'listing') {
        const from = date(f.follow_up_from ?? ''), to = date(f.follow_up_to ?? '');
        if (from) {
            parts.push(`${a}next_follow_up_date >= ?`);
            binds.push(from);
        }
        if (to) {
            parts.push(`${a}next_follow_up_date <= ?`);
            binds.push(to);
        }
        if (f.duplicates === '1')
            parts.push(`${a}duplicate_of IS NOT NULL`);
    }
    return { where: parts.length ? 'WHERE ' + parts.join(' AND ') : '', binds };
}
