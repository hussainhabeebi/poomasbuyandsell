// Minimal D1-compatible adapter over node:sqlite for testing the CRM data layer
// and the real migration files.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import type { DB, Stmt } from '../../lib/crm/repo.ts';
type Bindable = null | number | bigint | string | Uint8Array;
const coerce = (v: unknown): Bindable => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v as Bindable;
class Statement implements Stmt {
    db: DatabaseSync; sql: string; values: unknown[];
    constructor(db: DatabaseSync, sql: string, values: unknown[] = []) { this.db = db; this.sql = sql; this.values = values; }
    bind(...values: unknown[]) { return new Statement(this.db, this.sql, values); }
    exec() { const st = this.db.prepare(this.sql); return { st, args: this.values.map(coerce) }; }
    async first<T>() { const { st, args } = this.exec(); return (st.get(...args) ?? null) as T | null; }
    async all<T>() { const { st, args } = this.exec(); return { results: st.all(...args) as T[] }; }
    async run() { const { st, args } = this.exec(); return st.run(...args); }
}
export class TestD1 implements DB {
    sqlite: DatabaseSync;
    constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON'); }
    prepare(sql: string) { return new Statement(this.sqlite, sql); }
    async batch(statements: Stmt[]) {
        this.sqlite.exec('BEGIN');
        try {
            const out = [];
            for (const s of statements)
                out.push(await (s as Statement).run());
            this.sqlite.exec('COMMIT');
            return out;
        }
        catch (e) {
            this.sqlite.exec('ROLLBACK');
            throw e;
        }
    }
    applyMigration(file: string) {
        for (const part of readFileSync(new URL('../../drizzle/' + file, import.meta.url), 'utf8').split('--> statement-breakpoint'))
            if (part.trim())
                this.sqlite.exec(part);
    }
    static migrationFiles() { return readdirSync(new URL('../../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort(); }
    static migrated() { const db = new TestD1(); for (const f of TestD1.migrationFiles()) db.applyMigration(f); return db; }
}
