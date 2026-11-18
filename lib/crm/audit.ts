import { SENSITIVE_FIELDS, type EntityType } from './permissions.ts';
// Builds an audit change set. Sensitive values are never copied into the audit
// log: only the fact that they changed is recorded.
export function auditChanges(entity: EntityType, before: Record<string, unknown> | null, after: Record<string, unknown>) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(after)) {
        if (k === 'updated_at' || k === 'phone_normalized')
            continue;
        const prev = before ? before[k] ?? null : null;
        if ((prev ?? null) === (v ?? null))
            continue;
        changes[k] = SENSITIVE_FIELDS[entity][k] ? { from: before && prev != null ? '[redacted]' : null, to: v == null ? null : '[redacted]' } : { from: prev, to: v ?? null };
    }
    return changes;
}
