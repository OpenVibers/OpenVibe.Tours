'use strict';
/**
 * Places, cities and walks in OpenVibe.Search (server/search-index.js): a sweep puts every page in the outbox as one
 * tours.index_document.upserted, exactly the contract (contracts 0.274.0), with a page that answers; a second sweep
 * sends nothing; a place whose row is gone becomes a tombstone, once. The documents say what the pages say.
 */
const assert = require('assert');
const contracts = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');
const { seed } = require('./helpers/seed');
const { describePlace, describeCity, describeRoute } = require('../server/search-index');

(async () => {
    const t = await boot();
    const { s, searchIndex } = t.ctx;
    const outbox = async () => (await s.db.many('SELECT envelope FROM event_outbox ORDER BY id')).map((r) => r.envelope);
    const valid = (env) => {
        assert.ok(contracts.validate('events.event-envelope@1', env).valid, 'envelope');
        const p = contracts.validate(env.event_type, env.payload);
        assert.ok(p.valid, `${env.event_type}: ${JSON.stringify(p.errors)}`);
        assert.strictEqual(env.source, 'tours');
        return env;
    };
    try {
        await seed(t);
        const counts = { place: 0, city: 0, route: 0 };
        counts.place = (await s.db.many('SELECT id FROM tours_places')).length;
        counts.city = (await s.db.many('SELECT id FROM tours_cities')).length;
        counts.route = (await s.db.many('SELECT id FROM tours_routes')).length;

        await check('a sweep sends every place, city and walk once, as the contract says, and their pages answer', async () => {
            assert.ok(counts.place && counts.city, `the jobs made pages (${JSON.stringify(counts)})`);
            const res = await searchIndex.sweep();
            for (const type of ['place', 'city', 'route']) {
                assert.deepStrictEqual(res[type], { seen: counts[type], sent: counts[type], removed: 0, failed: 0 }, type);
            }
            const envs = (await outbox()).map(valid);
            for (const type of ['place', 'city', 'route']) {
                const doc = envs.map((e) => e.payload).find((p) => p.type === type);
                if (!doc) continue;
                const path = new URL(doc.canonical_url).pathname;
                assert.strictEqual((await t.get(path)).status, 200, `${type} page ${path}`);
            }
            const city = envs.map((e) => e.payload).find((p) => p.type === 'city');
            assert.match(city.summary, /places? to see and \d+ self-guided walks?/);
            assert.strictEqual((await searchIndex.sweep()).place.sent, 0, 'a second sweep sends nothing');
        });

        await check('a place whose row is gone becomes a tombstone, once', async () => {
            const gone = (await s.db.many('SELECT id FROM tours_places ORDER BY id DESC LIMIT 1'))[0].id;
            await s.db.many('DELETE FROM tours_places WHERE id = $1 RETURNING id', [gone]);
            const before = (await outbox()).length;
            const res = await searchIndex.sweep();
            assert.strictEqual(res.place.removed, 1);
            assert.strictEqual(res.city.sent, 1, 'its city counts one place fewer');
            const env = valid((await outbox()).slice(before).find((e) => e.event_type === 'tours.index_document.deleted'));
            assert.strictEqual(env.event_type, 'tours.index_document.deleted');
            assert.deepStrictEqual([env.payload.type, env.payload.id], ['place', gone]);
            assert.strictEqual((await searchIndex.sweep()).place.removed, 0);
        });

        await check('the words: a place\'s kind, city and access; a city\'s counts; a walk\'s shape', async () => {
            const p = describePlace({ name: 'Hongya Cave', kind: 'theme_park', city_name: 'Chongqing', city_slug: 'chongqing', country: 'China', fee: 'no', wheelchair: 'yes', description: 'Stilted houses on the river.' });
            assert.strictEqual(p.summary, 'Theme park in Chongqing, China. Stilted houses on the river. Free to visit. Step-free.');
            assert.deepStrictEqual(p.facets, { city: 'chongqing', country: 'China', kind: 'theme_park' });
            const c = describeCity({ id: 'chongqing', name: 'Chongqing', country: 'China', summary: 'A city on the Yangtze.', places: 1, routes: 0 });
            assert.strictEqual(c.title, 'Chongqing, China');
            assert.match(c.summary, /1 place to see and 0 self-guided walks/);
            assert.strictEqual(describeCity({ id: 'x', name: 'X', country: 'Y', places: 0, routes: 0 }).noindex, true, 'an empty city is noindex');
            const r = describeRoute({ title: 'Old town walk', city_name: 'Chongqing', city_slug: 'chongqing', country: 'China', stop_count: 6, distance_m: 3200, duration_min: 90 });
            assert.match(r.summary, /6 stops, 3\.2 km, about 90 minutes/);
        });
    } finally {
        done();
    }
})();
