'use strict';
/**
 * The source jobs against the fixture sources: the top cities and their Wikivoyage pages, Overpass places, generated
 * routes from See lists, Live IRL streams/VODs and Rent stays. One run is counted, a second run is idempotent, and
 * every row keeps its source URL and fetch time. The receipt is in tours_job_runs.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        await check('cities: Wikidata coordinates, Commons licence, Wikivoyage summary and a See source', async () => {
            const out = await t.ctx.jobs.runOnce('cities', { limit: 100 });
            assert.strictEqual(out.status, 'ok', JSON.stringify(out));
            assert.strictEqual(out.counts.cities, 6);
            assert.ok(out.counts.withSummary >= 5);
            const tokyo = await t.ctx.s.db.maybe("SELECT * FROM tours_cities WHERE slug = 'tokyo'");
            assert.strictEqual(tokyo.wikidata_id, 'Q1490');
            assert.strictEqual(tokyo.image_license, 'CC BY-SA 4.0');
            assert.match(tokyo.image_credit, /photographer/i);
            assert.strictEqual(tokyo.country, 'Japan');
            assert.strictEqual(tokyo.country_code, 'JP');
            assert.match(tokyo.summary, /capital of Japan/);
            const lisbon = await t.ctx.s.db.maybe("SELECT * FROM tours_cities WHERE slug = 'lisbon'");
            assert.match(lisbon.source_url, /wikivoyage\.org\/wiki\/Lisbon/);
            const src = await t.ctx.s.db.maybe('SELECT * FROM tours_city_sources WHERE city_id = $1', [lisbon.id]);
            const parsed = JSON.parse(src.wikitext);
            assert.ok(parsed.pages.some((p) => p.title === 'Lisbon/Alfama'), 'the district page is stored');
            assert.ok(parsed.see.filter((x) => x.hasCoords).length >= 4);
        });

        await check('places: tourism=* only, stable ids, OSM source and fetch time; a hotel is not a place', async () => {
            const out = await t.ctx.jobs.runOnce('places', { limit: 100 });
            assert.strictEqual(out.status, 'ok', JSON.stringify(out));
            assert.strictEqual(out.counts.places, 18);
            assert.ok(out.counts.wikivoyagePlaces >= 35);
            const rows = await t.ctx.s.db.many("SELECT * FROM tours_places WHERE source = 'openstreetmap' ORDER BY id");
            assert.strictEqual(rows.length, 18);
            assert.ok(rows.every((p) => /openstreetmap\.org/.test(p.source_url) && p.fetched_at));
            assert.ok(!rows.some((p) => p.kind === 'hotel'));
            const wv = await t.ctx.s.db.many("SELECT * FROM tours_places WHERE source = 'wikivoyage'");
            assert.ok(wv.length >= 30);
            assert.ok(wv.every((p) => /wikivoyage\.org/.test(p.source_url) && p.osm_type === 'wikivoyage'));
            const before = (await t.ctx.s.db.many('SELECT id FROM tours_places ORDER BY id')).map((p) => p.id).join(',');
            await t.ctx.s.db.exec('UPDATE tours_cities SET osm_fetched_at = NULL');
            const again = await t.ctx.jobs.runOnce('places', { limit: 100 });
            assert.strictEqual(again.counts.places, 18);
            const after = (await t.ctx.s.db.many('SELECT id FROM tours_places ORDER BY id')).map((p) => p.id).join(',');
            assert.strictEqual(after, before, 'a rerun updates the same place ids');
            assert.ok(t.upstreams.state.requests.some((r) => r.path === '/interpreter' && /OpenVibeTours/.test(r.headers['user-agent'])));
        });

        await check('routes: generated from Wikivoyage See lists, cited, audio off, idempotent', async () => {
            const out = await t.ctx.jobs.runOnce('routes', { limit: 100 });
            assert.strictEqual(out.status, 'ok', JSON.stringify(out));
            assert.strictEqual(out.counts.routes, 6);
            assert.strictEqual(out.counts.stops, 36);
            const route = await t.ctx.s.db.maybe("SELECT * FROM tours_routes WHERE slug = 'tokyo-see-1'");
            assert.strictEqual(route.generated, true);
            assert.match(route.source_url, /wikivoyage\.org/);
            const stops = await t.ctx.s.db.many('SELECT * FROM tours_route_stops WHERE route_id = $1 ORDER BY position', [route.id]);
            assert.strictEqual(stops.length, 6);
            assert.ok(stops.every((s) => s.audio_status === 'none' && s.audio_url === null));
            assert.ok(stops.every((s) => /wikivoyage\.org/.test(s.source_url)));
            assert.ok(stops.some((s) => s.place_id), 'a stop matches an OSM place by name or proximity');
            const again = await t.ctx.jobs.runOnce('routes', { limit: 100 });
            assert.strictEqual(again.counts.routes, 6);
            assert.strictEqual(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM tours_routes'), 6);
            assert.strictEqual(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM tours_route_stops'), 36);
        });

        await check('live: IRL streams, VODs and clips only, public Live/video URLs, a city when the title names one', async () => {
            const out = await t.ctx.jobs.runOnce('live');
            assert.strictEqual(out.status, 'ok', JSON.stringify(out));
            assert.strictEqual(out.counts.streams, 1);
            assert.strictEqual(out.counts.vods, 1);
            assert.strictEqual(out.counts.clips, 1);
            assert.strictEqual(out.counts.withCity, 3);
            const stream = await t.ctx.s.db.maybe("SELECT * FROM tours_live WHERE kind = 'stream'");
            assert.strictEqual(stream.city_name, 'Lisbon');
            assert.strictEqual(stream.url, 'https://openvibe.live/@ada');
            const vod = await t.ctx.s.db.maybe("SELECT * FROM tours_live WHERE kind = 'vod'");
            assert.strictEqual(vod.url, 'https://openvibe.video/v/77');
            assert.strictEqual(vod.city_name, 'Paris');
            const clip = await t.ctx.s.db.maybe("SELECT * FROM tours_live WHERE kind = 'clip'");
            assert.strictEqual(clip.url, 'https://openvibe.video/c/5');
            assert.strictEqual(clip.city_name, 'Lisbon');
        });

        await check('stays: a Rent listing for its city with the price the listing states', async () => {
            const out = await t.ctx.jobs.runOnce('stays', { limit: 100 });
            assert.strictEqual(out.status, 'ok', JSON.stringify(out));
            assert.strictEqual(out.counts.stays, 1);
            const stay = await t.ctx.s.db.maybe('SELECT * FROM tours_stays');
            assert.strictEqual(stay.city_name, 'Lisbon');
            assert.strictEqual(Number(stay.price), 1200);
            assert.strictEqual(stay.currency, 'EUR');
            assert.match(stay.url, /^https:\/\/openvibe\.rent\/listings\/rnt_/);
        });

        await check('a run that found nothing to work on is not fresh: the next boot runs it again', async () => {
            // 2026-11-01: places, routes and stays ran before the first cities landed, found none, and counted as fresh
            // for a week. Now an empty run is not fresh, and the scheduler runs them as soon as cities are added.
            const db = t.ctx.s.db;
            await db.exec(`INSERT INTO tours_job_runs (job, started_at, finished_at, status, counts) VALUES ('routes', now(), now(), 'ok', $1::jsonb)`, [JSON.stringify({ cities: 0, routes: 0, errors: [] })]);
            assert.strictEqual(await t.ctx.jobs.isFresh('routes'), false, 'an empty run is not fresh');
            await db.exec(`INSERT INTO tours_job_runs (job, started_at, finished_at, status, counts) VALUES ('routes', now() + interval '1 second', now() + interval '1 second', 'ok', $1::jsonb)`, [JSON.stringify({ cities: 3, routes: 2, errors: [] })]);
            assert.strictEqual(await t.ctx.jobs.isFresh('routes'), true, 'a run that worked is');
        });

        await check('every job left a receipt with its counts', async () => {
            const rows = await t.ctx.s.db.many("SELECT DISTINCT ON (job) job, status, counts FROM tours_job_runs ORDER BY job, started_at DESC");
            assert.deepStrictEqual(rows.map((r) => r.job).sort(), ['cities', 'live', 'places', 'routes', 'stays']);
            for (const row of rows) assert.ok(['ok', 'partial'].includes(row.status), `${row.job}: ${row.status}`);
        });
    } finally {
        await t.close();
    }
    done();
})();
