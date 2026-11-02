'use strict';
/**
 * A place's English name (migration 0004, OpenStreetMap name:en): 252 places in six cities had a name in Chinese or
 * Japanese script only, so an English search never found them ("Hongya Cave" is 洪崖洞). The OSM mapping keeps name:en
 * when it differs; the page and lists show it first with the place's own name beside it; the title, JSON-LD and the
 * Search document carry both; the places job names a version, so the first boot with it refreshes the marked cities.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { seed } = require('./helpers/seed');
const osm = require('../server/sources/osm');
const { describePlace } = require('../server/search-index');

const node = (tags) => ({ type: 'node', id: 9001, lat: 29.56, lon: 106.58, tags: { tourism: 'attraction', ...tags } });

(async () => {
    const t = await boot();
    try {
        await seed(t);

        await check('OpenStreetMap: name:en is kept when it differs from name, and only then', async () => {
            assert.strictEqual(osm.placeFromElement(node({ name: '洪崖洞', 'name:en': 'Hongya Cave' }), 'c1', null).nameEn, 'Hongya Cave');
            assert.strictEqual(osm.placeFromElement(node({ name: 'Old Tower', 'name:en': 'Old Tower' }), 'c1', null).nameEn, null);
            assert.strictEqual(osm.placeFromElement(node({ name: '洪崖洞' }), 'c1', null).nameEn, null);
        });

        const city = await t.ctx.s.db.maybe('SELECT id, slug, name FROM tours_cities ORDER BY id LIMIT 1');
        const id = await t.ctx.store.upsertPlace({ ...osm.placeFromElement(node({ name: '洪崖洞', 'name:en': 'Hongya Cave' }), city.id, new Date().toISOString()) });

        await check('the place page: the English name as the heading, its own name beside it, both in the title and JSON-LD', async () => {
            const r = await t.get(`/place/${id}`);
            assert.strictEqual(r.status, 200);
            assert.match(r.text, /<h1>Hongya Cave<\/h1>/);
            assert.match(r.text, /<p class="tr-local-name">洪崖洞<\/p>/);
            assert.match(r.text, /<title>Hongya Cave \(洪崖洞\)/);
            assert.match(r.text, /"name":"Hongya Cave","alternateName":"洪崖洞"/);
        });

        await check('the city page lists it by its English name, with its own name in the line under it', async () => {
            const r = await t.get(`/city/${city.slug}`);
            assert.strictEqual(r.status, 200);
            assert.match(r.text, /<strong>Hongya Cave<\/strong><span class="tr-muted">洪崖洞 · attraction/);
        });

        await check('a row leaves out a kind its name already says, and the facts join without a stray separator', async () => {
            const views = require('../server/views');
            assert.strictEqual(views.kindUnlessNamed({ name: 'Bose museum', kind: 'museum' }), '');
            assert.strictEqual(views.kindUnlessNamed({ name: 'Old Tower', kind: 'attraction' }), 'attraction');
            assert.strictEqual(views.kindUnlessNamed({ name: '马迭尔宾馆', name_en: 'Modern Hotel', kind: 'hotel' }), '');
        });

        await check('the Search document is titled with both names, and the sweep sends it', async () => {
            assert.strictEqual(describePlace({ name: '洪崖洞', name_en: 'Hongya Cave', kind: 'attraction', city_name: 'Chongqing', country: 'China' }).title, 'Hongya Cave (洪崖洞)');
            assert.strictEqual(describePlace({ name: 'Old Tower', name_en: null, kind: 'attraction', city_name: 'X', country: 'Y' }).title, 'Old Tower');
            await t.ctx.searchIndex.sweep();
            const env = (await t.ctx.s.db.many("SELECT envelope FROM event_outbox WHERE envelope->'payload'->>'id' = $1", [id])).pop();
            assert.ok(env, 'an envelope for the place');
            assert.strictEqual(env.envelope.payload.title, 'Hongya Cave (洪崖洞)');
            assert.ok(!String(env.envelope.payload.body || '').includes('Attraction in'), 'the body does not repeat the summary (the snippet reads both)');
        });

        await check('the places job names a version, so a run under older rules is not fresh', async () => {
            const runs = await t.ctx.store.latestJobRuns();
            const places = runs.find((r) => r.job === 'places');
            const counts = typeof places.counts === 'string' ? JSON.parse(places.counts) : places.counts;
            assert.strictEqual(counts.version, 'name-en-1');
        });

        await check('the migration marks a city by a name with no Latin letter, not by an accent', async () => {
            const row = await t.ctx.s.db.maybe("SELECT ('洪崖洞' !~ '[A-Za-zÀ-ɏ]') AS cjk, ('Musée du Louvre' !~ '[A-Za-zÀ-ɏ]') AS accented, ('Ἀκρόπολις' !~ '[A-Za-zÀ-ɏ]') AS greek");
            assert.deepStrictEqual([row.cjk, row.accented, row.greek], [true, false, true]);
        });
    } finally {
        done();
    }
})();
