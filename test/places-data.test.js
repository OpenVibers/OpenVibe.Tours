'use strict';
const assert = require('assert');
const fixture = require('./fixtures/seattle-districts.json');
const { boot, check, done } = require('./helpers/boot');
const { parseCityPage } = require('../server/sources/wikivoyage');
const { overpassQuery, placeFromElement, createOverpass } = require('../server/sources/osm');
const { isPlace } = require('../server/places/is-place');

(async () => {
    await check('recorded Seattle district See and Do listings contain many real places', async () => {
        const names = fixture.pages.flatMap((page) => {
            const parsed = parseCityPage(page.wikitext, page.title, { districts: 0 });
            return [...parsed.see, ...parsed.do].filter((x) => x.hasCoords && isPlace(x.name)).map((x) => x.name);
        });
        assert.ok(fixture.districts.length >= 10);
        assert.ok(names.length >= 24);
        assert.ok(names.includes('Space Needle'));
        assert.ok(!names.includes('Seattle CityPASS'));
    });
    await check('Overpass queries only named destinations and protects wikidata-tagged results', async () => {
        const tagged = overpassQuery(47.6, -122.3, 15000, true);
        const ordinary = overpassQuery(47.6, -122.3, 15000);
        for (const query of [tagged, ordinary]) {
            assert.match(query, /\["name"\]/);
            assert.match(query, /museum\|gallery\|viewpoint/);
            assert.match(query, /park\|garden\|nature_reserve/);
            assert.doesNotMatch(query, /tourism"\]/);
        }
        assert.match(tagged, /\["wikidata"\]/);
        assert.ok(ordinary.indexOf('["wikidata"]') < ordinary.lastIndexOf('out center tags 400'));
        const calls = [];
        const fetchImpl = async (_url, opts) => {
            const query = new URLSearchParams(opts.body).get('data');
            calls.push(query);
            const elements = [{ type: 'node', id: 1, lat: 47.6, lon: -122.3, tags: { name: 'Space Needle', tourism: 'attraction', wikidata: 'Q1' } },
                    { type: 'node', id: 1, lat: 47.6, lon: -122.3, tags: { name: 'Space Needle', tourism: 'attraction', wikidata: 'Q1' } },
                    { type: 'node', id: 2, lat: 47.61, lon: -122.31, tags: { name: 'Seattle CityPASS', tourism: 'attraction' } }];
            return { ok: true, status: 200, text: async () => JSON.stringify({ elements }) };
        };
        const osm = createOverpass({ config: { upstreams: { overpass: 'https://example.test/interpreter', timeoutMs: 1000 },
            openData: { userAgent: 'Tours test', radiusM: 15000 } }, fetchImpl });
        const result = await osm.tourism(47.6, -122.3);
        assert.strictEqual(result.elements.length, 2);
        assert.strictEqual(calls.length, 1);
        assert.match(calls[0], /\["wikidata"\]/);
        assert.ok(!placeFromElement(result.elements[1], 'cty_1', result.fetchedAt));
        assert.ok(!placeFromElement({ type: 'node', id: 3, lat: 47.6, lon: -122.3,
            tags: { name: 'Visitor centre', tourism: 'attraction', shop: 'yes' } }, 'cty_1', result.fetchedAt));
        assert.ok(!isPlace('A scenic place', { instanceLabel: 'travel agency' }));
        assert.ok(!isPlace('Seattle Pass'));
        assert.ok(!isPlace('Seattle Tours'));
    });
    const t = await boot();
    try {
        t.upstreams.state.nominatim.seattle = [{ name: 'Seattle', type: 'city', addresstype: 'city', lat: '47.6062', lon: '-122.3321',
            address: { city: 'Seattle', country: 'United States', country_code: 'us' }, extratags: { wikidata: 'Q5083' } }];
        t.upstreams.state.pages.Seattle += fixture.districts.map((x) => `[[${x}|district]]`).join(' ');
        for (const page of fixture.pages.slice(1)) t.upstreams.state.pages[page.title] = page.wikitext;
        t.upstreams.state.notable = [
            { item: { value: 'http://www.wikidata.org/entity/Q9991' }, label: { value: 'Seattle CityPASS' },
                coordinate: { value: 'Point(-122.3 47.6)' }, sitelinks: { value: '100' }, instanceLabel: { value: 'tourist attraction' } },
            { item: { value: 'http://www.wikidata.org/entity/Q9992' }, label: { value: 'New Seattle Viewpoint' },
                coordinate: { value: 'Point(-122.33 47.62)' }, sitelinks: { value: '50' }, instanceLabel: { value: 'scenic viewpoint' } },
            { item: { value: 'http://www.wikidata.org/entity/Q9993' }, label: { value: 'Seattle Excursions' },
                coordinate: { value: 'Point(-122.34 47.63)' }, sitelinks: { value: '40' }, instanceLabel: { value: 'travel agency' } },
        ];
        await check('on-demand city follows every district, caches one Wikidata query, and lists at least 24 places', async () => {
            const city = await t.ctx.discover.ensureCity('Seattle');
            const places = await t.ctx.store.cityPlaces(city.id, { limit: 200 });
            assert.ok(places.length >= 24, String(places.length));
            assert.ok(places.some((p) => p.name === 'New Seattle Viewpoint'));
            assert.ok(!places.some((p) => p.name === 'Seattle CityPASS'));
            assert.ok(!places.some((p) => p.name === 'Seattle Excursions'));
            assert.strictEqual(t.upstreams.state.requests.filter((r) => r.path === '/sparql').length, 1);
            const queryRequest = t.upstreams.state.requests.find((r) => r.path === '/sparql');
            const query = new URLSearchParams(queryRequest.query.slice(1)).get('query');
            assert.match(query, /wdt:P131\+ wd:Q5083/);
            assert.match(query, /wdt:P31 \?kind/);
            assert.match(queryRequest.headers['user-agent'], /OpenVibeTours/);
            assert.strictEqual(t.upstreams.state.requests.filter((r) => r.path === '/w/api.php' && r.query.includes('action=parse')).length,
                1 + fixture.districts.length);
            await t.ctx.jobs.places.populateCity(city);
            assert.strictEqual(t.upstreams.state.requests.filter((r) => r.path === '/sparql').length, 1);
        });
        await check('an existing thin Seattle city page refreshes missing district data', async () => {
            const city = await t.ctx.store.cityBySlug('seattle');
            await t.ctx.s.db.exec('DELETE FROM tours_places WHERE city_id=$1', [city.id]);
            await t.ctx.s.db.exec('DELETE FROM tours_wikidata_city_places WHERE city_id=$1', [city.id]);
            await t.ctx.store.upsertCitySource(city.id, {
                wikivoyageTitle: 'Seattle', wikitext: JSON.stringify({ pages: [{ title: 'Seattle',
                    wikitext: t.upstreams.state.pages.Seattle, sourceUrl: 'https://en.wikivoyage.org/wiki/Seattle' }] }),
                sourceUrl: 'https://en.wikivoyage.org/wiki/Seattle', fetchedAt: new Date().toISOString(),
            });
            const before = t.upstreams.state.requests.filter((r) => r.path === '/w/api.php' && r.query.includes('action=parse')).length;
            const page = await t.get('/city/seattle');
            assert.strictEqual(page.status, 200);
            assert.ok((await t.ctx.store.cityPlaces(city.id, { limit: 200 })).length >= 24);
            assert.strictEqual(t.upstreams.state.requests.filter((r) => r.path === '/w/api.php' && r.query.includes('action=parse')).length - before,
                fixture.districts.length);
        });
    } finally { await t.close(); }
    done();
})().catch((err) => { process.stdout.write(String(err.stack || err)); process.exit(1); });
