'use strict';
/**
 * Trips belong to one Network subject: create, read, edit, add a place/route/stay, share read-only, and delete.
 * Another person can read a shared trip but can never change it; a private trip is a 404 to them. A session write
 * from another site is refused, and the HTML form path works the same as the API.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { seed } = require('./helpers/seed');

(async () => {
    const t = await boot();
    try {
        await seed(t);
        const kim = t.network.addUser('kim');
        const sam = t.network.addUser('sam');

        await check('create: a valid city and dates; a bad date or a 61-day trip is refused', async () => {
            const r = await t.get('/api/v1/trips', { as: kim, json: { title: 'Lisbon in November', city_slug: 'lisbon', starts_on: '2026-11-10', ends_on: '2026-11-14', notes: 'Trams and tiles.' } });
            assert.strictEqual(r.status, 201);
            assert.match(r.headers.get('location'), /^\/api\/v1\/trips\/trip-/);
            assert.strictEqual(r.json().visibility, 'private');
            assert.strictEqual(r.json().city_id != null, true);
            for (const body of [
                { title: 'Bad', city_slug: 'lisbon', starts_on: '2026-11-14', ends_on: '2026-11-10' },
                { title: 'Long', city_slug: 'lisbon', starts_on: '2026-01-01', ends_on: '2026-04-01' },
                { title: 'No city', city_slug: 'nowhere', starts_on: '2026-11-10', ends_on: '2026-11-11' },
                { title: 'x', city_slug: 'lisbon', starts_on: '2026-11-10', ends_on: '2026-11-11' },
            ]) {
                const bad = await t.get('/api/v1/trips', { as: kim, json: body });
                assert.strictEqual(bad.status, 400, JSON.stringify(body));
                assert.strictEqual(bad.json().code, 'tours.trip.invalid');
            }
        });

        const list = await t.get('/api/v1/trips', { as: kim });
        const trip = list.json().trips[0];
        assert.ok(trip);

        await check('add a place, a route in the trip city, and a stay; the trip returns them in order', async () => {
            const place = await t.ctx.s.db.maybe("SELECT id FROM tours_places WHERE name = 'Senso-ji'");
            const lisbonRoute = await t.ctx.s.db.maybe("SELECT id FROM tours_routes WHERE slug = 'lisbon-see-1'");
            const tokyoRoute = await t.ctx.s.db.maybe("SELECT id FROM tours_routes WHERE slug = 'tokyo-see-1'");
            const stay = await t.ctx.s.db.maybe('SELECT id FROM tours_stays LIMIT 1');
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}/places`, { as: kim, json: { place_id: place.id, note: 'Go early.' } })).status, 201);
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}/route`, { as: kim, json: { route_id: lisbonRoute.id } })).status, 200);
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}/route`, { as: kim, json: { route_id: tokyoRoute.id } })).status, 400);
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}/stays`, { as: kim, json: { stay_id: stay.id } })).status, 201);
            const own = await t.get(`/api/v1/trips/${trip.slug}`, { as: kim });
            assert.strictEqual(own.status, 200);
            const b = own.json();
            assert.strictEqual(b.mine, true);
            assert.strictEqual(b.places.length, 1);
            assert.strictEqual(b.places[0].trip_note, 'Go early.');
            assert.strictEqual(b.route.id, lisbonRoute.id);
            assert.strictEqual(b.route.stops.length, 6);
            assert.strictEqual(b.stays.length, 1);
        });

        await check('the owner can edit title and dates; another person cannot touch the trip', async () => {
            const patched = await t.get(`/api/v1/trips/${trip.slug}`, { as: kim, method: 'PATCH', json: { title: 'Lisbon, slowly', ends_on: '2026-11-15' } });
            assert.strictEqual(patched.status, 200);
            assert.strictEqual(patched.json().title, 'Lisbon, slowly');
            const foreign = await t.get(`/api/v1/trips/${trip.slug}`, { as: sam });
            assert.strictEqual(foreign.status, 404, 'a private trip is a 404 to another person');
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}`, { as: sam, method: 'PATCH', json: { title: 'Mine now' } })).status, 403);
        });

        await check('sharing: the link is read-only for anyone; only the owner can edit or unshare', async () => {
            const share = await t.get(`/api/v1/trips/${trip.slug}`, { as: kim, method: 'PATCH', json: { visibility: 'shared' } });
            assert.strictEqual(share.status, 200);
            const anon = await t.get(`/api/v1/trips/${trip.slug}`);
            assert.strictEqual(anon.status, 200);
            assert.strictEqual(anon.json().mine, false);
            assert.strictEqual(anon.json().trip.visibility, 'shared');
            const other = await t.get(`/api/v1/trips/${trip.slug}`, { as: sam });
            assert.strictEqual(other.status, 200);
            assert.strictEqual(other.json().mine, false);
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}`, { as: sam, method: 'DELETE' })).status, 403);
            const page = await t.get(`/trips/${trip.slug}`);
            assert.strictEqual(page.status, 200);
            assert.match(page.text, /Shared read-only/);
            assert.ok(!page.text.includes('Delete this trip'), 'a reader gets no owner controls');
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}`, { as: kim, method: 'PATCH', json: { visibility: 'private' } })).json().visibility, 'private');
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}`)).status, 404);
        });

        await check('remove a place, the route and a stay; delete the trip', async () => {
            await t.get(`/api/v1/trips/${trip.slug}`, { as: kim, method: 'PATCH', json: { visibility: 'shared' } });
            const b = (await t.get(`/api/v1/trips/${trip.slug}`, { as: kim })).json();
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}/places/${b.places[0].id}`, { as: kim, method: 'DELETE' })).status, 204);
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}/route`, { as: kim, json: { route_id: null } })).status, 200);
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}/stays/${b.stays[0].id}`, { as: kim, method: 'DELETE' })).status, 204);
            const after = (await t.get(`/api/v1/trips/${trip.slug}`, { as: kim })).json();
            assert.strictEqual(after.places.length, 0);
            assert.strictEqual(after.route, null);
            assert.strictEqual(after.stays.length, 0);
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}`, { as: kim, method: 'DELETE' })).status, 204);
            assert.strictEqual((await t.get(`/api/v1/trips/${trip.slug}`, { as: kim })).status, 404);
        });

        await check('a signed-in session write from another site is 403; the form path creates a trip', async () => {
            const cross = await t.get('/api/v1/trips', { as: kim, json: { title: 'Cross site', city_slug: 'lisbon', starts_on: '2026-11-10', ends_on: '2026-11-11' }, headers: { 'sec-fetch-site': 'cross-site' } });
            assert.strictEqual(cross.status, 403);
            assert.strictEqual(cross.json().code, 'tours.cross_site');
            const form = await t.get('/trips', { as: kim, form: { title: 'A form trip', city: 'lisbon', starts_on: '2026-12-01', ends_on: '2026-12-03' } });
            assert.strictEqual(form.status, 303);
            assert.match(form.headers.get('location'), /^\/trips\/trip-/);
            const page = await t.get(form.headers.get('location'), { as: kim });
            assert.strictEqual(page.status, 200);
            assert.match(page.text, /A form trip/);
        });
    } finally {
        await t.close();
    }
    done();
})();
