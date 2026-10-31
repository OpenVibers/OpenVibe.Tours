'use strict';
/**
 * The pages are whole without JavaScript and carry real data: the room with live/place-of-day/cities/routes/stays,
 * a city with its places and routes, a place with the TouristAttraction JSON-LD, a route with the MapLibre map and
 * the TouristTrip itinerary, the trip sign-in, discovery artifacts, and the 404.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { seed } = require('./helpers/seed');

(async () => {
    const t = await boot();
    try {
        await seed(t);

        await check('home: hero, live rail, place of the day, top cities, routes, stays, FAQ and the dev section', async () => {
            const r = await t.get('/');
            assert.strictEqual(r.status, 200);
            assert.match(r.headers.get('cache-control'), /public, max-age=60/);
            for (const needle of ['Go anywhere: fly, stay, walk, watch', 'Live tours now', 'Place of the day', 'Top cities', 'Self-guided routes', 'Stays', 'Questions', 'The API', 'OpenStreetMap', 'Wikivoyage', 'Wikidata']) {
                assert.ok(r.text.includes(needle), needle);
            }
            assert.match(r.text, /IRL walk in Lisbon/);
            assert.match(r.text, /href="\/city\/lisbon"/);
            assert.match(r.text, /href="\/routes\/rte_/);
            assert.match(r.text, /href="\/stays"/);
            assert.match(r.text, /TouristAttraction|TouristDestination|FAQPage/);
            assert.match(r.text, /<main id="main"/);
        });

        await check('city page: summary, image licence, places, routes, live, stays and Tourist JSON-LD', async () => {
            const r = await t.get('/city/lisbon');
            assert.strictEqual(r.status, 200);
            assert.match(r.text, /Lisbon/);
            assert.match(r.text, /capital of Portugal|seven hills/);
            assert.match(r.text, /CC BY-SA 4\.0/);
            assert.match(r.text, /"@type":"TouristDestination"/);
            assert.match(r.text, /"@type":"TouristAttraction"/);
            assert.match(r.text, /"@type":"TouristTrip"/);
            assert.match(r.text, /href="\/place\/plc_/);
            assert.match(r.text, /href="\/routes\/rte_/);
            assert.match(r.text, /A flat in Alfama/);
            assert.match(r.text, /IRL walk in Lisbon/);
            assert.strictEqual((await t.get('/city/nowhere')).status, 404);
        });

        await check('place page: TouristAttraction JSON-LD, OSM link, source and fetch time', async () => {
            const place = await t.ctx.s.db.maybe("SELECT id FROM tours_places WHERE source = 'openstreetmap' LIMIT 1");
            const r = await t.get(`/place/${place.id}`);
            assert.strictEqual(r.status, 200);
            assert.match(r.text, /"@type":"TouristAttraction"/);
            assert.match(r.text, /openstreetmap\.org\/node\//);
            assert.match(r.text, /fetched/);
            assert.match(r.text, /OpenStreetMap/);
        });

        await check('route page: MapLibre, the fallback SVG, cited stops, audio off and TouristTrip itinerary', async () => {
            const route = await t.ctx.s.db.maybe("SELECT id FROM tours_routes WHERE slug = 'tokyo-see-1'");
            const r = await t.get(`/routes/${route.id}`);
            assert.strictEqual(r.status, 200);
            assert.match(r.text, /"@type":"TouristTrip"/);
            assert.match(r.text, /"@type":"TouristAttraction"/);
            assert.match(r.text, /id="tr-maplibre"/);
            assert.match(r.text, /maplibre-gl@/);
            assert.match(r.text, /id="tr-map-fallback"/);
            assert.match(r.text, /OpenStreetMap/);
            assert.match(r.text, /Wikivoyage note/);
            assert.match(r.text, /OpenVibe\.AI has no speech-synthesis API today/);
            assert.match(r.text, /© OpenStreetMap contributors/);
        });

        await check('live, stays, flights, developers and 404 render; trips ask for sign-in', async () => {
            const live = await t.get('/live');
            assert.strictEqual(live.status, 200);
            assert.match(live.text, /IRL walk in Lisbon/);
            assert.match(live.text, /Live tours now/);
            const stays = await t.get('/stays');
            assert.strictEqual(stays.status, 200);
            assert.match(stays.text, /A flat in Alfama/);
            const flights = await t.get('/flights');
            assert.strictEqual(flights.status, 200);
            assert.match(flights.text, /official airline-neutral search/);
            const dev = await t.get('/developers');
            assert.strictEqual(dev.status, 200);
            assert.match(dev.text, /\/api\/v1\/openapi\.json/);
            assert.match(dev.text, /OpenStreetMap via Overpass/);
            const trips = await t.get('/trips');
            assert.strictEqual(trips.status, 401);
            assert.match(trips.text, /Sign in with OpenVibe/);
            assert.strictEqual((await t.get('/nope')).status, 404);
        });

        await check('discovery: robots, sitemap, llms and llms-full list the public pages', async () => {
            const robots = await t.get('/robots.txt');
            assert.strictEqual(robots.status, 200);
            assert.match(robots.text, /Sitemap: https:\/\/openvibe\.tours\/sitemap\.xml/);
            assert.match(robots.text, /Disallow: \/trips/);
            const sitemap = await t.get('/sitemap.xml');
            assert.strictEqual(sitemap.status, 200);
            assert.match(sitemap.text, /\/city\/lisbon/);
            assert.match(sitemap.text, /\/routes\/rte_/);
            const llms = await t.get('/llms.txt');
            assert.strictEqual(llms.status, 200);
            assert.match(llms.text, /OpenVibe\.Tours/);
            const full = await t.get('/llms-full.txt');
            assert.strictEqual(full.status, 200);
            assert.match(full.text, /Lisbon/);
        });
    } finally {
        await t.close();
    }
    done();
})();
