'use strict';

// A checked Commons image is copied once into Media as a public object. The file's Commons page,
// author and licence stay on the place row; Media serves only the smaller image bytes.
//
// Every copy (download from Commons or Openverse, then upload to Media) runs one at a time for the whole process, one
// every UPLOAD_GAP_MS:
// - Media takes at most 30 uploads a minute and 600 an hour from one caller (media.object.upload, 429 rate_limited);
//   one copy every 6.5 s is about 550 an hour, under both.
// - Commons refuses bursts too: on 11-09 the places job asked it for every place of a batch at once (371 downloads in a
//   minute) and every one came back 429. Only the upload was paced then, not the download.
// A 429 from Media pauses every copy; a 429 from a picture host pauses downloads from that host (Retry-After, at least
// PAUSE_MS). Paused or refused copies return null and the place is deferred to a later run, never marked "no photo".
const UPLOAD_GAP_MS = 6_500;
const PAUSE_MS = 10 * 60 * 1000;
const MAX_PAUSE_MS = 60 * 60 * 1000;
// One queue, one clock and one set of pauses for the process: the places job, the cities job and on-demand discovery
// each make a cache, and together they must stay under the limits.
const pacing = { tail: Promise.resolve(), nextCopyAt: 0, pausedUntil: new Map() };

function resetPhotoPacing() {
    pacing.tail = Promise.resolve();
    pacing.nextCopyAt = 0;
    pacing.pausedUntil.clear();
}

function isPaused(key) {
    return Date.now() < (pacing.pausedUntil.get(key) || 0);
}

function pause(key, ms, log, why) {
    if (!isPaused(key)) log.warn(`[Tours photos] ${why}: copies pause for ${Math.round(ms / 60000)} minutes`);
    pacing.pausedUntil.set(key, Date.now() + ms);
}

function retryAfterMs(res) {
    const raw = res?.headers?.get ? res.headers.get('retry-after') : null;
    let ms = PAUSE_MS;
    if (raw) {
        const secs = Number(raw);
        ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(raw) - Date.now();
        if (!Number.isFinite(ms)) ms = PAUSE_MS;
    }
    return Math.min(MAX_PAUSE_MS, Math.max(PAUSE_MS, ms));
}

function oneAtATime(fn) {
    const run = pacing.tail.then(fn, fn);
    pacing.tail = run.then(() => {}, () => {});
    return run;
}

function createPhotoCache({ config, s, fetchImpl = globalThis.fetch, log = console, objectsClient = null, uploadGapMs = UPLOAD_GAP_MS }) {
    let objects = objectsClient;
    function client() {
        if (!objects) {
            const { createServiceTokenClient } = require('openvibe-sdk/auth');
            const { createObjectsClient } = require('openvibe-sdk/media');
            const tokenClient = createServiceTokenClient({
                tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: config.oauth.clientId,
                clientSecret: config.oauth.clientSecret, audience: 'openvibe.media', scope: config.media.scope,
            });
            objects = createObjectsClient({ app: 'tours', baseUrl: config.media.url, tokenClient });
        }
        return objects;
    }
    async function copied(image) {
        const old = await s.db.maybe('SELECT media_url FROM tours_photo_assets WHERE source_url=$1', [image.sourceUrl]);
        return old ? { ...image, url: old.media_url } : null;
    }
    async function copy(image, src, host) {
        // Waited in the queue: Media or this host may have said "too many" since, and another caller may have copied it.
        if (isPaused('media') || isPaused(host)) return null;
        const done = await copied(image);
        if (done) return done;
        const wait = pacing.nextCopyAt - Date.now();
        if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
        pacing.nextCopyAt = Date.now() + uploadGapMs;
        try {
            // Commons renders only its standard thumbnail widths (250, 330, 500, 960, 1280 …): 640 answered 400 for every
            // file, so no photo reached Media (11-08). Ask for 960; if that is refused (a small original cannot be enlarged),
            // take the exact URL Commons' imageinfo returned.
            const tries = [];
            if (host === 'commons' && /\/\d+px-[^/]+$/.test(src.pathname)) { const t = new URL(src); t.pathname = t.pathname.replace(/\/\d+px-([^/]+)$/, '/960px-$1'); tries.push(t.toString()); }
            tries.push(src.toString());
            let res = null;
            for (const u of tries) {
                res = await fetchImpl(u, { headers: { 'User-Agent': config.openData.userAgent }, signal: AbortSignal.timeout(12_000) });
                if (res.ok || res.status === 429) break;
            }
            if (res.status === 429) {
                pause(host, retryAfterMs(res), log, `${src.hostname} is rate limiting picture downloads (429)`);
                return null;
            }
            if (!res.ok) { log.warn(`[Tours photos] ${src.hostname} answered ${res.status} for ${image.sourceUrl}`); return null; }
            const type = String(res.headers.get('content-type') || '').split(';')[0].toLowerCase();
            const length = Number(res.headers.get('content-length') || 0);
            if (!/^image\/(?:jpeg|png|webp)$/.test(type) || length > 4_000_000) return null;
            const bytes = Buffer.from(await res.arrayBuffer());
            if (bytes.length > 4_000_000) return null;
            const file = image.sourceUrl.split('/').pop().slice(0, 100) || 'place-photo.jpg';
            const obj = await client().upload(bytes, { kind: 'file', visibility: 'public', mimeType: type, filename: file });
            const url = obj.public_url || obj.url;
            if (!url || !/^https:\/\/openvibe\.media\//.test(url)) { log.warn(`[Tours photos] Media answered no public openvibe.media URL for ${image.sourceUrl}`); return null; }
            await s.db.exec(`INSERT INTO tours_photo_assets(source_url, media_id, media_url) VALUES ($1,$2,$3)
                ON CONFLICT(source_url) DO NOTHING`, [image.sourceUrl, obj.id, url]);
            return { ...image, url };
        } catch (err) {
            if (err && (err.status === 429 || /\b429\b|rate_limited/.test(String(err.message)))) {
                pause('media', PAUSE_MS, log, `Media is rate limiting uploads (${err.message})`);
                return null;
            }
            log.warn(`[Tours photos] copy failed for ${image.sourceUrl}: ${err.message}`);
            return null;
        }
    }
    async function cache(image) {
        if (!image?.sourceUrl || !image?.url) return image;
        if (config.drill) return image.provider === 'openverse' ? null : image;
        if (!config.oauth.clientSecret) return null;
        let src;
        try { src = new URL(image.url); } catch { return null; }
        const commons = /^(?:thumb|upload)\.wikimedia\.org$/.test(src.hostname);
        const openverse = src.hostname === 'api.openverse.org' && /^\/v1\/images\/[0-9a-f-]{36}\/thumb\/$/i.test(src.pathname);
        if (src.protocol !== 'https:' || (!commons && !openverse)) return null;
        // Already in Media: no download, even while copies are paused.
        const done = await copied(image);
        if (done) return done;
        const host = commons ? 'commons' : 'openverse';
        if (isPaused('media') || isPaused(host)) return null;
        return oneAtATime(() => copy(image, src, host));
    }
    return { cache };
}

module.exports = { createPhotoCache, resetPhotoPacing };
