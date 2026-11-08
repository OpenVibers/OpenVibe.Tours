'use strict';
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { reusableImage } = require('../server/sources/wikidata');
const { overpassQuery } = require('../server/sources/osm');
const { streamOf, clipOf, placeIdOf } = require('../server/sources/live');
const { rankPlace } = require('../server/jobs/places');
const { extractGuide, parseEntity } = require('../server/sources/wikidata');

(async () => {
    await check('only credited, reusable Commons licences are accepted', async () => {
        const base = { url: 'https://thumb.wikimedia.org/a.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg', credit: 'A photographer' };
        for (const license of ['CC BY 4.0', 'CC BY-SA 4.0', 'CC0', 'PDM']) assert.ok(reusableImage({ ...base, license }), license);
        for (const license of ['CC BY-NC 4.0', 'CC BY-ND 4.0', null]) assert.ok(!reusableImage({ ...base, license }), String(license));
        assert.ok(!reusableImage({ ...base, credit: null, license: 'CC BY 4.0' }));
        assert.match(overpassQuery(47.6, -122.3, 15000), /leisure.*park\|garden/);
        assert.ok(rankPlace({ imageUrl: 'photo' }, { sitelinks: 50 }, 10_000) > rankPlace({}, { sitelinks: 2 }, 100));
        const guide = extractGuide('Kubota Garden is a public Japanese garden in Seattle.\n== Features and programs ==\nMajor features include the Bamboo Grove and Necklace of Ponds. A public tour runs in summer.\n== Flora ==\nJapanese maples change colour in the fall.', 'Kubota Garden');
        assert.match(guide.features, /Bamboo Grove/);
        assert.match(guide.visit, /public tour/);
        assert.match(guide.season, /fall/);
        assert.strictEqual(parseEntity({ id: 'Q1', claims: { P373: [{ mainsnak: { datavalue: { value: 'Kubota Garden' } } }] } }).commonsCategory, 'Category:Kubota Garden');
    });
    await check('only canonical Tours place links attach Live streams and clips', async () => {
        const id = 'plc_0123456789ABCDEFGHJKMNPQRS';
        const place_url = `https://openvibe.tours/place/kubota-garden-${id}`;
        assert.strictEqual(placeIdOf({ place_url }), id);
        assert.strictEqual(placeIdOf({ place_url: 'https://elsewhere.example/place/kubota-garden-' + id }), null);
        const options = { fetchedAt: new Date().toISOString(), liveUrl: 'https://openvibe.live', videoBase: 'https://openvibe.video' };
        assert.strictEqual(streamOf({ id: 1, username: 'ada', place_url }, options).placeId, id);
        assert.strictEqual(clipOf({ id: 2, username: 'ada', place_url }, options).placeId, id);
    });
    const t = await boot();
    try {
        t.upstreams.state.nominatim.seattle = [{
            name: 'Seattle', type: 'city', addresstype: 'city', lat: '47.6062', lon: '-122.3321',
            address: { city: 'Seattle', state: 'Washington', country: 'United States', country_code: 'us' },
            extratags: { wikidata: 'Q5083' },
        }];
        t.upstreams.state.nominatim['kubota garden'] = [{
            name: 'Kubota Garden', type: 'garden', osm_type: 'way', osm_id: 42006992,
            lat: '47.51282', lon: '-122.26607', address: { city: 'Seattle' },
            extratags: { website: 'https://www.kubotagarden.org/', wikidata: 'Q6441303' },
        }];
        await check('a city outside the seed is built once and cached', async () => {
            const api = await t.get('/api/v1/cities?q=seattle');
            assert.strictEqual(api.status, 200);
            assert.strictEqual(api.json().count, 1);
            const first = await t.get('/city/seattle');
            assert.strictEqual(first.status, 200);
            assert.match(first.text, /Things to do in Seattle/);
            assert.match(first.text, /Kubota Garden/);
            assert.match(first.text, /Photo: A photographer/);
            const second = await t.get('/city/seattle');
            assert.strictEqual(second.status, 200);
            const calls = t.upstreams.state.requests.filter((r) => r.path === '/search');
            assert.strictEqual(calls.length, 1);
            assert.match(calls[0].headers['user-agent'], /OpenVibeTours/);
        });
        await check('free view includes only explicit fee=no and place actions hand off safely', async () => {
            const city = await t.ctx.store.cityBySlug('seattle');
            const free = await t.get('/city/seattle/free');
            assert.strictEqual(free.status, 200);
            assert.match(free.text, /Free things to do in Seattle/);
            assert.match(free.text, /The old tower/);
            assert.doesNotMatch(free.text, /Museum of the city/);
            const place = (await t.ctx.store.cityPlaces(city.id)).find((p) => p.name === 'Kubota Garden');
            const detail = await t.get(`/place/${place.id}`);
            assert.match(detail.text, /Go here together/);
            assert.match(detail.text, /openvibe\.fun\/plans\/new/);
            assert.match(detail.text, /openvibe\.live\/broadcast\?/);
            const placeSearch = await t.get('/api/v1/places?q=Kubota%20Garden');
            assert.strictEqual(placeSearch.status, 200);
            assert.strictEqual(placeSearch.json().place.name, 'Kubota Garden');
            const date = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
            const reminder = await t.get(`/remind-place/${place.id}?date=${date}`);
            assert.strictEqual(reminder.status, 303);
            const target = new URL(reminder.headers.get('location'));
            assert.strictEqual(target.host, 'openvibe.today');
            assert.strictEqual(target.searchParams.get('from'), 'openvibe.tours');
            assert.strictEqual(target.searchParams.get('at'), `${date}T18:00:00Z`);
        });
    } finally { await t.close(); }
    done();
})().catch((err) => { process.stdout.write(String(err.stack || err)); process.exit(1); });
