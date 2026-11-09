'use strict';
/**
 * Tours' photo cache asks Commons for a thumbnail width Commons renders (960), falls back to the exact URL imageinfo
 * returned when that is refused, and says so in the log when nothing can be copied. On 11-08 every place photo failed
 * silently: the cache asked for 640px, which Commons answers with 400. On 11-09 Commons answered 429 to every download:
 * the places job asked for a whole batch at once (371 in a minute). Copies now run one at a time, and a host's 429
 * pauses downloads from it.
 *
 *   node test/photo-cache-widths.test.js
 */
const assert = require('assert');
const { createPhotoCache, resetPhotoPacing } = require('../server/places/photo-cache');

const config = { oauth: { clientSecret: 'x' }, openData: { userAgent: 'test' }, drill: false };
const db = { maybe: async () => null, exec: async () => {} };
const image = { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Kubota.jpg/1280px-Kubota.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Kubota.jpg' };
const ok = (type = 'image/jpeg') => ({ ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? type : '1000') }, arrayBuffer: async () => new Uint8Array(1000).buffer });
const refused = { ok: false, status: 400, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) };
const uploaded = [];
const objectsClient = { upload: async (bytes) => { uploaded.push(bytes.length); return { id: 'obj_1', public_url: 'https://openvibe.media/api/v2/tours/objects/obj_1' }; } };

(async () => {
    // 1. 960px is asked first and copied.
    let asked = [];
    let cache = createPhotoCache({ config, s: { db }, objectsClient, uploadGapMs: 0, log: { warn() {} }, fetchImpl: async (u) => { asked.push(u); return ok(); } });
    let out = await cache.cache(image);
    assert.ok(/\/960px-Kubota\.jpg$/.test(asked[0]), 'a standard Commons width first');
    assert.strictEqual(out.url, 'https://openvibe.media/api/v2/tours/objects/obj_1');

    // 2. 960 refused (a small original): the exact imageinfo URL is used.
    asked = [];
    cache = createPhotoCache({ config, s: { db }, objectsClient, uploadGapMs: 0, log: { warn() {} }, fetchImpl: async (u) => { asked.push(u); return /960px/.test(u) ? refused : ok(); } });
    out = await cache.cache(image);
    assert.deepStrictEqual(asked.map((u) => u.replace(/.*\//, '')), ['960px-Kubota.jpg', '1280px-Kubota.jpg']);
    assert.ok(out && out.url.startsWith('https://openvibe.media/'), 'copied from the original URL');

    // 3. Both refused: null, and the log says why.
    const warned = [];
    cache = createPhotoCache({ config, s: { db }, objectsClient, uploadGapMs: 0, log: { warn: (m) => warned.push(m) }, fetchImpl: async () => refused });
    out = await cache.cache(image);
    assert.strictEqual(out, null);
    assert.ok(warned.some((m) => /answered 400/.test(m)), 'a refused photo is logged, not silent');
    // 4. Uploads are paced: two copies are at least the gap apart.
    const times = [];
    const paced = createPhotoCache({ config, s: { db }, uploadGapMs: 150, log: { warn() {} }, fetchImpl: async () => ok(),
        objectsClient: { upload: async () => { times.push(Date.now()); return { id: 'o', public_url: 'https://openvibe.media/api/v2/tours/objects/o' }; } } });
    await Promise.all([paced.cache({ ...image, sourceUrl: image.sourceUrl + '1' }), paced.cache({ ...image, sourceUrl: image.sourceUrl + '2' })]);
    assert.ok(times.length === 2 && times[1] - times[0] >= 140, 'one upload per gap');
    // 5. Media says 429: copies pause (the next one downloads nothing) and the pause is logged once.
    const warned429 = [];
    let fetched = 0;
    const limited = createPhotoCache({ config, s: { db }, uploadGapMs: 0, log: { warn: (m) => warned429.push(m) }, fetchImpl: async () => { fetched += 1; return ok(); },
        objectsClient: { upload: async () => { throw Object.assign(new Error("POST /objects -> 429 rate_limited"), { status: 429 }); } } });
    assert.strictEqual(await limited.cache({ ...image, sourceUrl: image.sourceUrl + "429a" }), null);
    const before = fetched;
    assert.strictEqual(await limited.cache({ ...image, sourceUrl: image.sourceUrl + "429b" }), null);
    assert.strictEqual(fetched, before, "paused: nothing is downloaded");
    assert.strictEqual(warned429.filter((m) => /rate limiting uploads/.test(m)).length, 1, "the pause is logged once");

    // 6. Copies run one at a time for the process, a gap apart: a batch never downloads in parallel.
    resetPhotoPacing();
    let inFlight = 0, most = 0;
    const starts = [];
    const queued = createPhotoCache({ config, s: { db }, objectsClient, uploadGapMs: 60, log: { warn() {} },
        fetchImpl: async () => { inFlight += 1; most = Math.max(most, inFlight); starts.push(Date.now()); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return ok(); } });
    await Promise.all([1, 2, 3, 4].map((n) => queued.cache({ ...image, sourceUrl: `${image.sourceUrl}q${n}` })));
    assert.strictEqual(most, 1, 'one download at a time');
    assert.ok(starts.every((t, i) => i === 0 || t - starts[i - 1] >= 55), 'downloads are a gap apart');

    // 7. Commons says 429: no second try for that file, Commons downloads pause (logged once), Openverse still copies.
    resetPhotoPacing();
    const warnedHost = [];
    let commonsAsked = 0, openverseAsked = 0;
    const tooMany = { ok: false, status: 429, headers: { get: (h) => (h === 'retry-after' ? '5' : 'text/html') }, arrayBuffer: async () => new ArrayBuffer(0) };
    const hosts = createPhotoCache({ config, s: { db }, objectsClient, uploadGapMs: 0, log: { warn: (m) => warnedHost.push(m) },
        fetchImpl: async (u) => { if (/wikimedia/.test(u)) { commonsAsked += 1; return tooMany; } openverseAsked += 1; return ok(); } });
    const batch = await Promise.all([1, 2, 3].map((n) => hosts.cache({ ...image, sourceUrl: `${image.sourceUrl}c${n}` })));
    assert.deepStrictEqual(batch, [null, null, null], 'refused copies are deferred');
    assert.strictEqual(commonsAsked, 1, 'after a 429 nothing more is asked of Commons (not even the fallback URL)');
    assert.strictEqual(warnedHost.filter((m) => /rate limiting picture downloads/.test(m)).length, 1, 'the pause is logged once');
    assert.ok(warnedHost.some((m) => /pause for 10 minutes/.test(m)), 'a short Retry-After still pauses at least 10 minutes');
    const verse = await hosts.cache({ url: 'https://api.openverse.org/v1/images/0b8a4c62-5f3e-4c1e-9a1b-2a7f4e1d9c33/thumb/', sourceUrl: 'https://www.flickr.com/photos/x/1', provider: 'openverse' });
    assert.ok(verse && openverseAsked === 1, 'another host is not paused');

    // 8. While paused, a photo already in Media is still returned.
    const known = createPhotoCache({ config, s: { db: { maybe: async () => ({ media_url: 'https://openvibe.media/o/med_known1' }), exec: async () => {} } },
        objectsClient, uploadGapMs: 0, log: { warn() {} }, fetchImpl: async () => { throw new Error('no download expected'); } });
    assert.strictEqual((await known.cache(image)).url, 'https://openvibe.media/o/med_known1');
    resetPhotoPacing();
    console.log('photo cache: 960px first, the imageinfo URL as fallback, refusals logged, one copy at a time, 429s pause');
})().catch((e) => { console.error(e); process.exitCode = 1; });
