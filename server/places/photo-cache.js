'use strict';

// A checked Commons image is copied once into Media as a public object. The file's Commons page,
// author and licence stay on the place row; Media serves only the smaller image bytes.
function createPhotoCache({ config, s, fetchImpl = globalThis.fetch, log = console }) {
    let objects;
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
        if (config.drill) return image.provider === 'openverse' ? null : image;
        if (!config.oauth.clientSecret) return null;
        const old = await s.db.maybe('SELECT media_url FROM tours_photo_assets WHERE source_url=$1', [image.sourceUrl]);
        if (old) return { ...image, url: old.media_url };
        try {
            const src = new URL(image.url);
            const commons = /^(?:thumb|upload)\.wikimedia\.org$/.test(src.hostname);
            const openverse = src.hostname === 'api.openverse.org' && /^\/v1\/images\/[0-9a-f-]{36}\/thumb\/$/i.test(src.pathname);
            if (src.protocol !== 'https:' || (!commons && !openverse)) return null;
            if (commons) src.pathname = src.pathname.replace(/\/\d+px-([^/]+)$/, '/640px-$1');
            const res = await fetchImpl(src.toString(), { headers: { 'User-Agent': config.openData.userAgent }, signal: AbortSignal.timeout(12_000) });
            const type = String(res.headers.get('content-type') || '').split(';')[0].toLowerCase();
            const length = Number(res.headers.get('content-length') || 0);
            if (!res.ok || !/^image\/(?:jpeg|png|webp)$/.test(type) || length > 4_000_000) return null;
            const bytes = Buffer.from(await res.arrayBuffer());
            if (bytes.length > 4_000_000) return null;
            const file = image.sourceUrl.split('/').pop().slice(0, 100) || 'place-photo.jpg';
            const obj = await client().upload(bytes, { kind: 'file', visibility: 'public', mimeType: type, filename: file });
            const url = obj.public_url || obj.url;
            if (!url || !/^https:\/\/openvibe\.media\//.test(url)) return null;
            await s.db.exec(`INSERT INTO tours_photo_assets(source_url, media_id, media_url) VALUES ($1,$2,$3)
                ON CONFLICT(source_url) DO NOTHING`, [image.sourceUrl, obj.id, url]);
            return { ...image, url };
        } catch (err) {
            log.warn(`[Tours photos] Media copy unavailable: ${err.message}`);
            return null;
        }
    }
    return { cache };
}

module.exports = { createPhotoCache };
