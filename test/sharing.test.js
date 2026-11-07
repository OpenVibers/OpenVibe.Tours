'use strict';
/**
 * Sharing a trip (design 2026-11-06, visibility step 3): the one Share sheet (openvibe-sdk/share) and the one check,
 * canView, on the trip page and the trip API. Editing asks canEdit, so Specific people with Can edit plan together.
 *
 *   - a new trip is Only me; its page carries the Share button for its owner;
 *   - Everyone and Anyone with the link are readable by whoever has the address, and only the owner edits;
 *   - Specific people shows the gate, never the title, places or notes, to somebody not on the list;
 *   - Can edit really edits; Can view only reads;
 *   - the person's default for new trips, and "apply to all", work;
 *   - a trip is never on a gathered page: not the sitemap, not llms.txt.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { seed } = require('./helpers/seed');

(async () => {
    const t = await boot();
    try {
        await seed(t);
        const kim = t.network.addUser('kim');
        const bo = t.network.addUser('bo');
        const cy = t.network.addUser('cy');

        const call = (pathname, o = {}) => {
            const { headers, ...rest } = o;
            return t.get(pathname, { ...rest, headers: { 'x-requested-with': 'ov-share', ...(headers || {}) } });
        };
        const share = (slug, o = {}) => call(`/api/v1/trip/${encodeURIComponent(slug)}/share`, o);
        const setShare = async (slug, body, as) => {
            const first = await share(slug, { as });
            assert.strictEqual(first.status, 200, first.text);
            const etag = first.headers.get('etag');
            assert.ok(etag);
            return await share(slug, { as, method: 'PUT', json: body, headers: { 'if-match': etag } });
        };
        const audienceRow = async (slug) => await t.ctx.s.db.maybe(
            'SELECT audience FROM shares WHERE service = $1 AND kind = $2 AND resource_id = $3', ['tours', 'trip', slug]);
        const newTrip = async (as, title = 'Lisbon in November') => {
            const made = await t.get('/api/v1/trips', { as, json: { title, city_slug: 'lisbon', starts_on: '2026-11-10', ends_on: '2026-11-14', notes: 'Trams and tiles.' } });
            assert.strictEqual(made.status, 201, made.text);
            return made.json().slug;
        };

        let slug;
        await check('a new trip is Only me, and its page carries the Share button for its owner', async () => {
            slug = await newTrip(kim);
            assert.deepStrictEqual(await audienceRow(slug), { audience: 'private' });
            const mine = await t.get(`/trips/${slug}`, { as: kim });
            assert.strictEqual(mine.status, 200, mine.text);
            assert.ok(mine.text.includes('data-ov-share-sheet') && mine.text.includes('data-kind="trip"'));
            assert.ok(mine.text.includes('ov-share.js'));
            assert.ok(mine.text.includes('Only me'));
            const other = await t.get(`/trips/${slug}`, { as: bo });
            assert.strictEqual(other.status, 404);
            assert.ok(!other.text.includes('Lisbon in November'), 'the trip is never named to somebody else');
            assert.strictEqual((await t.get(`/trips/${slug}`)).status, 404);
        });

        await check('Anyone with the link reads the page and the API, and cannot edit', async () => {
            const saved = await setShare(slug, { audience: 'link' }, kim);
            assert.strictEqual(saved.status, 200, saved.text);
            assert.strictEqual(saved.json().audience, 'link');
            const guest = await t.get(`/trips/${slug}`);
            assert.strictEqual(guest.status, 200, guest.text);
            assert.ok(guest.text.includes('Lisbon in November'));
            assert.ok(guest.text.includes('Anyone with the link'));
            assert.ok(!guest.text.includes('Delete this trip'));
            assert.ok(!guest.text.includes('action="/trips/' + slug + '/edit"'), 'a reader gets no edit form');
            const api = await t.get(`/api/v1/trips/${slug}`);
            assert.strictEqual(api.status, 200);
            assert.strictEqual(api.json().canEdit, false);
            assert.strictEqual((await t.get(`/api/v1/trips/${slug}`, { as: bo, method: 'PATCH', json: { title: 'Mine now' } })).status, 403);
        });

        await check('Specific people: an editor plans it, a viewer only reads, a stranger gets the gate', async () => {
            const saved = await setShare(slug, { audience: 'people', members: [{ name: 'bo', role: 'editor' }, { name: 'cy', role: 'viewer' }] }, kim);
            assert.strictEqual(saved.status, 200, saved.text);
            assert.strictEqual(saved.json().audience, 'people');
            const editor = await t.get(`/trips/${slug}`, { as: bo });
            assert.strictEqual(editor.status, 200, editor.text);
            assert.ok(editor.text.includes('Lisbon in November'));
            assert.ok(editor.text.includes('action="/trips/' + slug + '/edit"'), 'Can edit opens the forms');
            assert.ok(!editor.text.includes('Delete this trip'), 'only the owner deletes');
            const edited = await t.get(`/api/v1/trips/${slug}`, { as: bo, method: 'PATCH', json: { title: 'Lisbon, together' } });
            assert.strictEqual(edited.status, 200, edited.text);
            assert.strictEqual(edited.json().title, 'Lisbon, together');
            const viewer = await t.get(`/trips/${slug}`, { as: cy });
            assert.strictEqual(viewer.status, 200);
            assert.ok(!viewer.text.includes('action="/trips/' + slug + '/edit"'), 'Can view cannot edit');
            assert.strictEqual((await t.get(`/api/v1/trips/${slug}`, { as: cy, method: 'PATCH', json: { title: 'No' } })).status, 403);
            const stranger = t.network.addUser('di');
            const gate = await t.get(`/trips/${slug}`, { as: stranger });
            assert.strictEqual(gate.status, 404);
            assert.ok(gate.text.includes('shared with specific people'));
            assert.ok(!gate.text.includes('Lisbon, together'), 'the gate never shows the title');
            assert.ok(!gate.text.includes('Trams and tiles'), 'the gate never shows the notes');
            assert.strictEqual((await t.get(`/api/v1/trips/${slug}`, { as: stranger })).status, 404);
        });

        await check('the default applies to the next trip, and "apply to all" moves the existing one', async () => {
            const saved = await t.get('/trips/defaults', { as: kim, form: { audience: 'link', apply_all: '1' } });
            assert.strictEqual(saved.status, 303, saved.text);
            assert.deepStrictEqual(await audienceRow(slug), { audience: 'link' });
            const next = await newTrip(kim, 'Porto in December');
            assert.deepStrictEqual(await audienceRow(next), { audience: 'link' });
            const start = await t.get('/trips', { as: kim });
            assert.ok(start.text.includes('Who can open a new trip'), 'the default is on the product page');
            assert.strictEqual((await t.get(`/trips/${next}`)).status, 200, 'the next trip follows the default');
        });

        await check('a public trip: the owner\'s copy is private, no-store; the signed-out copy has no sheet data', async () => {
            const next = await newTrip(kim, 'A public trip');
            await setShare(next, { audience: 'public' }, kim);
            const mine = await t.get(`/trips/${next}`, { as: kim });
            assert.strictEqual(mine.status, 200);
            assert.match(mine.headers.get('cache-control'), /private/);
            assert.match(mine.headers.get('cache-control'), /no-store/);
            assert.ok(mine.text.includes('data-kind="trip"'), 'the owner gets the Share sheet');
            const anon = await t.get(`/trips/${next}`);
            assert.strictEqual(anon.status, 200);
            assert.match(anon.headers.get('cache-control'), /public/);
            assert.ok(!anon.text.includes('data-kind='), 'a shared cache never stores the sheet\'s kind');
            assert.ok(!anon.text.includes('data-id='), 'nor its id');
            assert.ok(!anon.text.includes('data-ov-share-sheet'), 'and the signed-out page carries no Share button');
            // Now the gathered-page rule on the same trip.
            const sitemap = await t.get('/sitemap.xml');
            assert.strictEqual(sitemap.status, 200);
            assert.ok(!sitemap.text.includes(next), 'a trip is not in the sitemap, even Everyone');
            const llms = await t.get('/llms.txt');
            assert.ok(!llms.text.includes(next), 'a trip is not in llms.txt');
            const robots = await t.get('/robots.txt');
            assert.ok(/Disallow: \/trips/.test(robots.text));
        });

        await check('a trip is never on a gathered page: not the sitemap, not llms.txt', async () => {
            const next = await newTrip(kim, 'A second public trip');
            await setShare(next, { audience: 'public' }, kim);
            const sitemap = await t.get('/sitemap.xml');
            assert.strictEqual(sitemap.status, 200);
            assert.ok(!sitemap.text.includes(next), 'a trip is not in the sitemap, even Everyone');
            const llms = await t.get('/llms.txt');
            assert.ok(!llms.text.includes(next), 'a trip is not in llms.txt');
            const robots = await t.get('/robots.txt');
            assert.ok(/Disallow: \/trips/.test(robots.text));
        });
    } finally {
        await t.close();
        done();
    }
})();
