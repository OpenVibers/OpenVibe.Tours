'use strict';
/**
 * The JSON API's public reads stay short and cacheable, its refusals are application/problem+json, and every route
 * the brief names exists. A trip write is a person; an app token is refused.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { seed } = require('./helpers/seed');

(async () => {
    const t = await boot();
    try {
        await seed(t);

        await check('GET /api/v1/cities: the catalogue, a q filter, and a bounded limit', async () => {
            const all = await t.get('/api/v1/cities');
            assert.strictEqual(all.status, 200);
            assert.strictEqual(all.json().count, 6);
            assert.match(all.headers.get('cache-control'), /public, max-age=60/);
            const lisbon = await t.get('/api/v1/cities?q=lis');
            assert.strictEqual(lisbon.json().count, 1);
            assert.strictEqual(lisbon.json().cities[0].slug, 'lisbon');
            for (const p of ['/api/v1/cities?limit=0', '/api/v1/cities?limit=201', '/api/v1/cities?offset=-1']) {
                const r = await t.get(p);
                assert.strictEqual(r.status, 400, p);
                assert.strictEqual(r.json().code, 'tours.invalid');
            }
        });

        await check('GET /api/v1/cities/:slug: one city with places, routes, live and stays; 404 otherwise', async () => {
            const r = await t.get('/api/v1/cities/lisbon');
            assert.strictEqual(r.status, 200);
            const b = r.json();
            assert.strictEqual(b.city.name, 'Lisbon');
            assert.ok(b.places.length >= 3);
            assert.ok(b.routes.length >= 1);
            assert.strictEqual(b.live[0].city_name, 'Lisbon');
            assert.strictEqual(b.stays[0].currency, 'EUR');
            assert.ok(b.city.source_url.startsWith('https://en.wikivoyage.org/'));
            assert.strictEqual((await t.get('/api/v1/cities/nowhere')).status, 404);
        });

        await check('GET /api/v1/places/:id and /routes/:id carry the source and the ordered stops', async () => {
            const place = await t.ctx.s.db.maybe("SELECT id FROM tours_places WHERE source = 'openstreetmap' LIMIT 1");
            const p = await t.get(`/api/v1/places/${place.id}`);
            assert.strictEqual(p.status, 200);
            assert.match(p.json().place.osm_url, /^https:\/\/www\.openstreetmap\.org\//);
            assert.ok(p.json().place.fetched_at);
            const route = await t.ctx.s.db.maybe('SELECT id FROM tours_routes WHERE slug = $1', ['tokyo-see-1']);
            const r = await t.get(`/api/v1/routes/${route.id}`);
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.json().route.stops.length, 6);
            assert.deepStrictEqual(r.json().route.stops.map((s) => s.position), [1, 2, 3, 4, 5, 6]);
            assert.ok(r.json().route.stops.every((s) => s.audio_status === 'none' && /wikivoyage\.org/.test(s.source_url)));
            assert.strictEqual((await t.get('/api/v1/places/plc_00000000000000000000000000')).status, 404);
        });

        await check('GET /api/v1/live: streams now and recent VODs', async () => {
            const r = await t.get('/api/v1/live');
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.json().live.length, 1);
            assert.strictEqual(r.json().recent.length, 2);
            assert.match(r.json().source, /OpenVibe\.Live/);
            assert.strictEqual(r.json().live[0].url, 'https://openvibe.live/@ada');
        });

        await check('GET /api/v1/openapi.json is OpenAPI 3.1 with every brief route', async () => {
            const r = await t.get('/api/v1/openapi.json');
            assert.strictEqual(r.status, 200);
            const doc = r.json();
            assert.strictEqual(doc.openapi, '3.1.0');
            for (const p of ['/api/v1/cities', '/api/v1/cities/{slug}', '/api/v1/places/{id}', '/api/v1/routes/{id}', '/api/v1/live', '/api/v1/trips', '/api/v1/trips/{slug}']) {
                assert.ok(doc.paths[p], p);
            }
            assert.ok(doc.components.schemas.City && doc.components.schemas.Place && doc.components.schemas.Route);
        });

        await check('malformed JSON and unknown routes are problem+json with stable codes', async () => {
            const bad = await t.get('/api/v1/trips', { as: t.network.addUser('kim'), body: '{', headers: { 'content-type': 'application/json' } });
            assert.strictEqual(bad.status, 400);
            assert.match(bad.headers.get('content-type'), /application\/problem\+json/);
            assert.strictEqual(bad.json().code, 'request.malformed_json');
            const nope = await t.get('/api/v1/nope');
            assert.strictEqual(nope.status, 404);
            assert.strictEqual(nope.json().code, 'route.not_found');
        });

        await check('an anonymous trip write is 401; an app token is 403, never silently a person', async () => {
            const anon = await t.get('/api/v1/trips', { json: { title: 'No', city_slug: 'lisbon', starts_on: '2026-11-10', ends_on: '2026-11-11' } });
            assert.strictEqual(anon.status, 401);
            assert.strictEqual(anon.json().code, 'tours.sign_in_required');
            const user = t.network.addUser('kim');
            const now = Math.floor(Date.now() / 1000);
            const app = t.network.signJwt({ iss: t.network.issuer(), sub: 'app:app_01JABCDEFGHJKMNPQRSTVWXYZ0', actor_type: 'app', aud: ['openvibe.tours'], cap: ['x.y.z'], project_id: 'prj_01JABCDEFGHJKMNPQRSTVWXYZ0', env: 'production', jti: 'app-test', subject_id: user.subject, iat: now, exp: now + 300 });
            const r = await t.get('/api/v1/trips', { bearer: app, json: { title: 'No', city_slug: 'lisbon', starts_on: '2026-11-10', ends_on: '2026-11-11' } });
            assert.strictEqual(r.status, 403);
            assert.strictEqual(r.json().code, 'tours.person_required');
        });
    } finally {
        await t.close();
    }
    done();
})();
