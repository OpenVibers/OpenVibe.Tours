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
            // Cards ask Wikimedia for the width they draw, not the 1200 px file the city page keeps.
            assert.match(r.text, /srcset="[^"]*\/330px-Tokyo_test\.jpg 330w[^"]*\/640px-Tokyo_test\.jpg 640w"/, 'cards carry 330/640');
            assert.match(r.text, /width="640" height="360"/, 'the card shape is declared');
            const cities = await t.get('/cities');
            assert.strictEqual(cities.status, 200);
            assert.match(cities.text, /sizes="58px"/, 'a city row says the 58 px it draws');
            assert.match(cities.text, /\/160px-Tokyo_test\.jpg 160w[^"]*\/330px-Tokyo_test\.jpg 330w/, 'a city row carries 160/330');
            // The FAQPage data asks exactly the questions the page shows (structured data names what is on the page).
            const ld = [...r.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => [].concat(JSON.parse(m[1])))
                .flatMap((x) => (x['@graph'] ? x['@graph'] : [x]));
            const faq = ld.find((x) => x['@type'] === 'FAQPage');
            assert.ok(faq && faq.mainEntity.length >= 3, 'the FAQPage data');
            const shown = r.text.replace(/<script[\s\S]*?<\/script>/g, '');
            for (const q of faq.mainEntity) assert.ok(shown.includes(q.name.replace(/'/g, '&#39;')) || shown.includes(q.name), `asked on the page: ${q.name}`);
            assert.match(r.text, /<main id="main"/);
        });

        await check('home: the pictures it shows are allowed to load (Wikimedia thumbnails, Live\'s recordings)', async () => {
            const r = await t.get('/');
            const img = String(r.headers.get('content-security-policy') || '').split(';').find((d) => d.trim().startsWith('img-src')) || '';
            ['https://upload.wikimedia.org', 'https://thumb.wikimedia.org', 'https://openvibe.media'].forEach((h) => assert.ok(img.includes(h), `img-src allows ${h}`));
            assert.ok(!/\b1 places\b/.test(r.text), 'one place is "1 place"');
        });

        await check('place of the day: a long description is cut at a word, with an ellipsis', async () => {
            const views = require('../server/views/index');
            const html = views.home ? views.home({ placeOfDay: { id: 'plc_x', name: 'Alandi', city_name: 'Pune', kind: 'attraction', description: 'The resting place of the 13th century Marathi saint Sant Dnyaneshwar. His devotees believe that he is still alive. A temple complex was built at Dnyaneshwar samadhi.' } }) : '';
            if (!html) return;
            const m = /Place of the day[\s\S]*?<span class="tr-muted">([^<]*)<\/span>/.exec(String(html));
            assert.ok(m, 'the card renders');
            assert.ok(/…$/.test(m[1]) && !/Dnyan…$/.test(m[1]), `cut at a word: ${m[1].slice(-30)}`);
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
            assert.match(r.text, /href="\/place\/[a-z0-9-]+-plc_/);
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
            // AGT-5: the home at /index.md, each page at its twin, Optional last.
            assert.match(llms.text, /\[OpenVibe\.Tours\]\(https:\/\/openvibe\.tours\/index\.md\)/, 'the home is /index.md');
            assert.match(llms.text, /\[Cities\]\(https:\/\/openvibe\.tours\/cities\.md\)/, 'a page is its twin');
            assert.match(llms.text, /\[Cities \(JSON\)\]\(https:\/\/openvibe\.tours\/api\/v1\/cities\)/, 'an API URL keeps its URL');
            assert.match(llms.text, /\n## Optional\n/);
            assert.match(llms.text, /\n## Optional\n\n[\s\S]*\[Sitemap\]\(https:\/\/openvibe\.tours\/sitemap\.xml\)/);
            assert.strictEqual(llms.text.lastIndexOf('\n## '), llms.text.indexOf('\n## Optional'), 'Optional is the last section');
            const own = [...llms.text.matchAll(/\]\((https:\/\/openvibe\.tours[^)\s]*)\)( \(HTML\))?/g)];
            assert.ok(own.length > 5, String(own.length));
            for (const [, url, html] of own) {
                const p = new URL(url).pathname;
                assert.ok(p.endsWith('.md') || /\.[a-z0-9]+$/.test(p) || p.startsWith('/api/') || html, `${url} is a twin, a file or marked (HTML)`);
            }
            const full = await t.get('/llms-full.txt');
            assert.strictEqual(full.status, 200);
            assert.match(full.text, /Lisbon/);
        });
    } finally {
        await t.close();
    }
    done();
})();
