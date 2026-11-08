'use strict';

// A checked Commons image is copied once into Media as a public object. The file's Commons page,
// author and licence stay on the place row; Media serves only the smaller image bytes.
// Media takes at most 30 uploads a minute and 600 an hour from one caller (media.object.upload, 429 rate_limited).
// One every UPLOAD_GAP_MS stays under both (about 550 an hour); a 429 pauses every copy for PAUSE_MS.
const UPLOAD_GAP_MS = 6_500;
const PAUSE_MS = 10 * 60 * 1000;
let pausedUntil = 0;
// One pace for the whole process: the places job and on-demand discovery each make a cache, and together they must
// stay under Media's limit too.
let nextUploadAt = 0;
function createPhotoCache({ config, s, fetchImpl = globalThis.fetch, log = console, objectsClient = null, uploadGapMs = UPLOAD_GAP_MS }) {
    let objects = objectsClient;
    async function uploadSlot() {
        const now = Date.now();
        const at = Math.max(now, nextUploadAt);
        nextUploadAt = at + uploadGapMs;
        if (at > now) await new Promise((ok) => setTimeout(ok, at - now));
    }
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
    async function cache(image) {
        if (!image?.sourceUrl || !image?.url) return image;
        // Media said "too many" a moment ago: skip (the place is deferred and tried at the next run).
        if (Date.now() < pausedUntil) return null;
        if (config.drill) return image.provider === 'openverse' ? null : image;
        if (!config.oauth.clientSecret) return null;
        const old = await s.db.maybe('SELECT media_url FROM tours_photo_assets WHERE source_url=$1', [image.sourceUrl]);
        if (old) return { ...image, url: old.media_url };
        try {
            const src = new URL(image.url);
            const commons = /^(?:thumb|upload)\.wikimedia\.org$/.test(src.hostname);
            const openverse = src.hostname === 'api.openverse.org' && /^\/v1\/images\/[0-9a-f-]{36}\/thumb\/$/i.test(src.pathname);
            if (src.protocol !== 'https:' || (!commons && !openverse)) return null;
            // Commons renders only its standard thumbnail widths (250, 330, 500, 960, 1280 …): 640 answered 400 for every
            // file, so no photo reached Media (11-08). Ask for 960; if that is refused (a small original cannot be enlarged),
            // take the exact URL Commons' imageinfo returned.
            const tries = [];
            if (commons && /\/\d+px-[^/]+$/.test(src.pathname)) { const t = new URL(src); t.pathname = t.pathname.replace(/\/\d+px-([^/]+)$/, '/960px-$1'); tries.push(t.toString()); }
            tries.push(src.toString());
            let res = null;
            for (const u of tries) {
                res = await fetchImpl(u, { headers: { 'User-Agent': config.openData.userAgent }, signal: AbortSignal.timeout(12_000) });
                if (res.ok) break;
            }
            if (!res.ok) { log.warn(`[Tours photos] ${src.hostname} answered ${res.status} for ${image.sourceUrl}`); return null; }
            const type = String(res.headers.get('content-type') || '').split(';')[0].toLowerCase();
            const length = Number(res.headers.get('content-length') || 0);
            if (!res.ok || !/^image\/(?:jpeg|png|webp)$/.test(type) || length > 4_000_000) return null;
            const bytes = Buffer.from(await res.arrayBuffer());
            if (bytes.length > 4_000_000) return null;
            const file = image.sourceUrl.split('/').pop().slice(0, 100) || 'place-photo.jpg';
            await uploadSlot();
            const obj = await client().upload(bytes, { kind: 'file', visibility: 'public', mimeType: type, filename: file });
            const url = obj.public_url || obj.url;
            if (!url || !/^https:\/\/openvibe\.media\//.test(url)) { log.warn(`[Tours photos] Media answered no public openvibe.media URL for ${image.sourceUrl}`); return null; }
            await s.db.exec(`INSERT INTO tours_photo_assets(source_url, media_id, media_url) VALUES ($1,$2,$3)
                ON CONFLICT(source_url) DO NOTHING`, [image.sourceUrl, obj.id, url]);
            return { ...image, url };
        } catch (err) {
            if (err && (err.status === 429 || /\b429\b|rate_limited/.test(String(err.message)))) {
                if (Date.now() >= pausedUntil) log.warn(`[Tours photos] Media is rate limiting uploads: copies pause for ${PAUSE_MS / 60000} minutes (${err.message})`);
                pausedUntil = Date.now() + PAUSE_MS;
                return null;
            }
            log.warn(`[Tours photos] Media copy unavailable: ${err.message}`);
            return null;
        }
    }
    return { cache };
}

module.exports = { createPhotoCache };
