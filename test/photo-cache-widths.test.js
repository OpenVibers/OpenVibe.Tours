'use strict';
/**
 * Tours' photo cache asks Commons for a thumbnail width Commons renders (960), falls back to the exact URL imageinfo
 * returned when that is refused, and says so in the log when nothing can be copied. On 11-08 every place photo failed
 * silently: the cache asked for 640px, which Commons answers with 400.
 *
 *   node test/photo-cache-widths.test.js
 */
const assert = require('assert');
const { createPhotoCache } = require('../server/places/photo-cache');

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
    let cache = createPhotoCache({ config, s: { db }, objectsClient, log: { warn() {} }, fetchImpl: async (u) => { asked.push(u); return ok(); } });
    let out = await cache.cache(image);
    assert.ok(/\/960px-Kubota\.jpg$/.test(asked[0]), 'a standard Commons width first');
    assert.strictEqual(out.url, 'https://openvibe.media/api/v2/tours/objects/obj_1');

    // 2. 960 refused (a small original): the exact imageinfo URL is used.
    asked = [];
    cache = createPhotoCache({ config, s: { db }, objectsClient, log: { warn() {} }, fetchImpl: async (u) => { asked.push(u); return /960px/.test(u) ? refused : ok(); } });
    out = await cache.cache(image);
    assert.deepStrictEqual(asked.map((u) => u.replace(/.*\//, '')), ['960px-Kubota.jpg', '1280px-Kubota.jpg']);
    assert.ok(out && out.url.startsWith('https://openvibe.media/'), 'copied from the original URL');

    // 3. Both refused: null, and the log says why.
    const warned = [];
    cache = createPhotoCache({ config, s: { db }, objectsClient, log: { warn: (m) => warned.push(m) }, fetchImpl: async () => refused });
    out = await cache.cache(image);
    assert.strictEqual(out, null);
    assert.ok(warned.some((m) => /answered 400/.test(m)), 'a refused photo is logged, not silent');
    console.log('photo cache: 960px first, the imageinfo URL as fallback, refusals logged');
})().catch((e) => { console.error(e); process.exitCode = 1; });
