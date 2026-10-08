import { database, identity, isAdmin, sameOrigin, body, failure, HttpError, rateLimit } from '@/lib/server';
import { decodeListing, publicListing, PACKAGES } from '@/lib/catalog';
import { listingInput, enquiryInput } from '@/lib/validation';
export async function GET(request: Request) { try {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope');
    if (scope === 'me' || scope === 'admin') {
        const user = await identity();
        const admin = scope === 'admin';
        if (admin && !isAdmin(user.email))
            throw new HttpError('Administrator access required.', 403);
        const db = database();
        const listings = await db.prepare(admin ? 'SELECT * FROM listings ORDER BY created_at DESC LIMIT 200' : 'SELECT * FROM listings WHERE owner_id=? ORDER BY created_at DESC LIMIT 200').bind(...(admin ? [] : [user.userId])).all();
        const promotions = await db.prepare(admin ? 'SELECT p.*,l.title FROM promotions p JOIN listings l ON l.id=p.listing_id ORDER BY p.created_at DESC LIMIT 200' : 'SELECT p.*,l.title FROM promotions p JOIN listings l ON l.id=p.listing_id WHERE p.owner_id=? ORDER BY p.created_at DESC LIMIT 200').bind(...(admin ? [] : [user.userId])).all();
        const enquiries = await db.prepare(admin ? 'SELECT e.*,l.title FROM enquiries e JOIN listings l ON l.id=e.listing_id ORDER BY e.created_at DESC LIMIT 200' : 'SELECT e.*,l.title FROM enquiries e JOIN listings l ON l.id=e.listing_id WHERE l.owner_id=? OR e.buyer_id=? ORDER BY e.created_at DESC LIMIT 200').bind(...(admin ? [] : [user.userId, user.userId])).all();
        const saves = await db.prepare('SELECT l.* FROM saved s JOIN listings l ON s.listing_id=l.id WHERE s.user_id=? AND l.status IN (\'published\',\'sold\') ORDER BY s.created_at DESC').bind(user.userId).all();
        return Response.json({ listings: listings.results.map(decodeListing), promotions: promotions.results, enquiries: enquiries.results, saved: saves.results.map(x => publicListing(decodeListing(x))), admin: isAdmin(user.email) }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const rows = await database().prepare("SELECT * FROM listings WHERE status='published' ORDER BY created_at DESC LIMIT 200").all();
    return Response.json({ listings: rows.results.map(x => publicListing(decodeListing(x))) }, { headers: { 'Cache-Control': 'no-store' } });
}
catch (e) {
    return failure(e);
} }
export async function POST(request: Request) { try {
    sameOrigin(request);
    const user = await identity();
    const input = await body(request);
    await rateLimit(user.userId, 'write', 60);
    const db = database(), now = new Date().toISOString();
    switch (input.action) {
        case 'listing': {
            const parsed = listingInput.safeParse(input.data);
            if (!parsed.success)
                throw new HttpError(parsed.error.issues[0].message);
            const d = parsed.data;
            await rateLimit(user.userId, 'listing', 10);
            const editing = typeof input.id === 'string';
            const existing = editing ? await db.prepare("SELECT id,slug FROM listings WHERE id=? AND owner_id=? AND status IN ('pending','published','rejected')").bind(input.id, user.userId).first<{
                id: string;
                slug: string;
            }>() : null;
            if (editing && !existing)
                throw new HttpError('This listing cannot be edited.', 404);
            const id = existing?.id || crypto.randomUUID(), slug = existing?.slug || d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) + '-' + id.slice(0, 8);
            for (const image of d.images) {
                const owned = await db.prepare('SELECT id FROM media WHERE id=? AND owner_id=? AND (listing_id IS NULL OR listing_id=?)').bind(image.split('/').pop(), user.userId, id).first();
                if (!owned)
                    throw new HttpError('A photo could not be attached. Please upload it again.');
            }
            const statements = [existing ? db.prepare("UPDATE listings SET seller_name=?,phone=?,title=?,category=?,subtype=?,emirate=?,area=?,price=?,intent=?,description=?,specs=?,images=?,video=?,permit=?,status='pending',rejection_reason=NULL,updated_at=? WHERE id=? AND owner_id=?").bind(d.sellerName, d.phone, d.title, d.category, d.subtype, d.emirate, d.area, d.price, d.intent, d.description, JSON.stringify(d.specs), JSON.stringify(d.images), d.video || null, d.permit || null, now, id, user.userId) : db.prepare('INSERT INTO listings (id,slug,owner_id,seller_name,seller_email,phone,title,category,subtype,emirate,area,price,intent,description,specs,images,video,permit,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id, slug, user.userId, d.sellerName, user.email, d.phone, d.title, d.category, d.subtype, d.emirate, d.area, d.price, d.intent, d.description, JSON.stringify(d.specs), JSON.stringify(d.images), d.video || null, d.permit || null, 'pending', now, now), ...d.images.map(image => db.prepare('UPDATE media SET listing_id=? WHERE id=? AND owner_id=? AND listing_id IS NULL').bind(id, image.split('/').pop(), user.userId))];
            await db.batch(statements);
            return Response.json({ id, slug, message: existing ? 'Changes submitted for review.' : 'Listing submitted for review.' }, { status: 201 });
        }
        case 'save': {
            const listing = await db.prepare("SELECT id FROM listings WHERE id=? AND status='published'").bind(input.listingId).first();
            if (!listing)
                throw new HttpError('Listing not available.', 404);
            if (input.saved)
                await db.prepare('INSERT OR IGNORE INTO saved (id,user_id,listing_id,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(), user.userId, input.listingId, now).run();
            else
                await db.prepare('DELETE FROM saved WHERE user_id=? AND listing_id=?').bind(user.userId, input.listingId).run();
            return Response.json({ ok: true });
        }
        case 'enquiry': {
            const p = enquiryInput.safeParse(input.data);
            if (!p.success)
                throw new HttpError(p.error.issues[0].message);
            const d = p.data;
            const listing = await db.prepare("SELECT id FROM listings WHERE id=? AND status='published'").bind(d.listingId).first();
            if (!listing)
                throw new HttpError('Listing is no longer available.', 404);
            await rateLimit(user.userId, 'enquiry', 15);
            await db.prepare('INSERT INTO enquiries (id,listing_id,buyer_id,name,email,phone,message,kind,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), d.listingId, user.userId, user.displayName, user.email, d.phone, d.message, d.kind, now).run();
            return Response.json({ message: 'Your enquiry is in the seller’s inbox.' });
        }
        case 'promotion': {
            if (!PACKAGES.some(p => p.id === input.packageId))
                throw new HttpError('Choose a promotion package.');
            const owned = await db.prepare("SELECT id FROM listings WHERE id=? AND owner_id=? AND status IN ('pending','published')").bind(input.listingId, user.userId).first();
            if (!owned)
                throw new HttpError('Choose one of your active listings.');
            const id = crypto.randomUUID();
            await db.prepare('INSERT INTO promotions (id,owner_id,listing_id,package_id,notes,status,created_at) VALUES (?,?,?,?,?,?,?)').bind(id, user.userId, input.listingId, input.packageId, String(input.notes || '').slice(0, 1500), 'requested', now).run();
            return Response.json({ id, message: 'Promotion requested. The team will confirm your quote and schedule.' }, { status: 201 });
        }
        case 'status': {
            const admin = isAdmin(user.email);
            const allowed = admin ? ['published', 'rejected', 'sold', 'withdrawn'] : ['sold', 'withdrawn'];
            if (!allowed.includes(input.status))
                throw new HttpError('Invalid status.');
            const row = await db.prepare('SELECT owner_id,status FROM listings WHERE id=?').bind(input.listingId).first<{
                owner_id: string;
                status: string;
            }>();
            if (!row || (!admin && row.owner_id !== user.userId))
                throw new HttpError('Listing not found.', 404);
            if (!admin && input.status === 'sold' && row.status !== 'published')
                throw new HttpError('Only a published listing can be marked sold.');
            await db.prepare('UPDATE listings SET status=?,rejection_reason=?,updated_at=? WHERE id=?').bind(input.status, admin && input.status === 'rejected' ? String(input.reason || 'Please contact the team.').slice(0, 1000) : null, now, input.listingId).run();
            return Response.json({ ok: true });
        }
        case 'quote': {
            if (!isAdmin(user.email))
                throw new HttpError('Administrator access required.', 403);
            const amount = Number(input.amount);
            if (!Number.isFinite(amount) || amount <= 0 || amount > 100000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001)
                throw new HttpError('Enter a valid AED quote.');
            const result = await db.prepare("UPDATE promotions SET amount=?,status='quoted' WHERE id=? AND status IN ('requested','quoted')").bind(amount, input.id).run();
            if (!result.meta.changes)
                throw new HttpError('This promotion cannot be quoted.');
            return Response.json({ ok: true });
        }
        default: throw new HttpError('Unknown action.');
    }
}
catch (e) {
    return failure(e);
} }
