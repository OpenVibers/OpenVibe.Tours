'use strict';

const { fetchJson, createPacer } = require('../sources/http');
const { createWikidata } = require('../sources/wikidata');
const { createWikivoyage } = require('../sources/wikivoyage-client');
const { parseCityPage } = require('../sources/wikivoyage');
const { placeFromElement } = require('../sources/osm');
const { slugify } = require('../store');
const { createPhotoCache } = require('./photo-cache');

function createDiscover({ config, s, store, jobs, fetchImpl = globalThis.fetch, log = console }) {
    const nominatimPace = createPacer(Math.max(1100, config.openData.minIntervalMs));
    const wikidata = createWikidata({ config, fetchImpl, pace: s.pace, log });
    const wikivoyage = createWikivoyage({ config, fetchImpl, pace: s.pace });
    const photoCache = createPhotoCache({ config, s, fetchImpl, log });
    const pending = new Map();
    const keyOf = (q) => String(q || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);

    async function search(q, limit = 5) {
        const url = `${config.upstreams.nominatim}/search?${new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', extratags: '1', namedetails: '1', limit: String(limit) })}`;
        const { json } = await fetchJson(url, {
            fetchImpl, pace: nominatimPace, userAgent: config.openData.userAgent,
            timeoutMs: Math.min(12_000, config.upstreams.timeoutMs), label: 'Nominatim', retries: 0,
        });
        return Array.isArray(json) ? json : [];
    }

    async function ensureCity(name, { populate = true } = {}) {
        const key = keyOf(name);
        if (key.length < 2 || key.length > 80) return null;
        const existing = await store.cityBySlug(slugify(key));
        if (existing) {
            if (!populate) return existing;
            if (pending.has(`city:${key}`)) return pending.get(`city:${key}`);
            const task = (async () => {
                const source = await store.citySource(existing.id);
                let stored = null;
                try { stored = JSON.parse(source?.wikitext || 'null'); } catch { /* old source format */ }
                let pages = Array.isArray(stored?.pages) ? [...stored.pages] : [];
                if (!pages.length) {
                    const main = await wikivoyage.page(existing.wikivoyage_title || existing.name);
                    if (main) pages = [main];
                }
                const districts = pages.length ? parseCityPage(pages[0].wikitext, pages[0].title,
                    { districts: config.openData.districtPages }).districts : [];
                const known = new Set(pages.map((p) => p.title));
                const missing = districts.filter((title) => !known.has(title));
                for (const title of missing) {
                    try {
                        const sub = await wikivoyage.page(title);
                        if (sub) pages.push(sub);
                    } catch (err) { log.warn(`[Tours discover] Wikivoyage ${title}: ${err.message}`); }
                }
                if (pages.length && (!source || missing.length)) await store.upsertCitySource(existing.id, {
                    wikivoyageTitle: pages[0].title, wikitext: JSON.stringify({ pages }),
                    sourceUrl: pages[0].sourceUrl, fetchedAt: pages[0].fetchedAt,
                });
                const notable = await s.db.maybe(`SELECT city_id FROM tours_wikidata_city_places
                    WHERE city_id=$1 AND fetched_at > now()-interval '7 days'`, [existing.id]);
                const osmFresh = existing.osm_fetched_at && Date.now() - new Date(existing.osm_fetched_at).getTime() < 7 * 86_400_000;
                if (missing.length || !notable || !osmFresh) {
                    try { await jobs.places.populateCity(existing); }
                    catch (err) { log.warn(`[Tours discover] places ${existing.name}: ${err.message}`); }
                }
                return store.cityBySlug(existing.slug);
            })().finally(() => pending.delete(`city:${key}`));
            pending.set(`city:${key}`, task);
            return task;
        }
        const cached = await s.db.maybe('SELECT city_id FROM tours_city_lookup WHERE query=$1 AND expires_at > now()', [key]);
        if (cached) return cached.city_id ? store.cityById(cached.city_id) : null;
        if (pending.has(`city:${key}`)) return pending.get(`city:${key}`);
        const task = (async () => {
            const hits = await search(name);
            const hit = hits.find((h) => ['city', 'town', 'municipality', 'village'].includes(h.addresstype || h.type)) || hits[0];
            const cityName = hit && (hit.address?.city || hit.address?.town || hit.address?.municipality || hit.address?.village || hit.name);
            const qid = hit?.extratags?.wikidata || null;
            const resolved = qid ? { qid } : (await wikidata.resolveQids([cityName || name])).get(cityName || name);
            if (!hit || !resolved || !/^Q[1-9][0-9]{0,11}$/.test(resolved.qid)) {
                await s.db.exec(`INSERT INTO tours_city_lookup(query, city_id, expires_at) VALUES ($1,NULL,now()+interval '1 day')
                    ON CONFLICT(query) DO UPDATE SET city_id=NULL, expires_at=EXCLUDED.expires_at`, [key]);
                return null;
            }
            const entity = (await wikidata.entities([resolved.qid])).get(resolved.qid);
            const nameOut = entity?.label || cityName || String(name).trim();
            const file = entity?.image ? (/^File:/i.test(entity.image) ? entity.image : `File:${entity.image}`) : null;
            const image = await photoCache.cache(file ? (await wikidata.imageInfo([file])).get(file) : null);
            const now = new Date().toISOString();
            const city = {
                name: nameOut, slug: slugify(nameOut), country: hit.address?.country || 'Unknown',
                countryCode: hit.address?.country_code?.toUpperCase() || null, region: hit.address?.state || null,
                lat: Number(hit.lat), lon: Number(hit.lon), population: entity?.population || null,
                wikidataId: resolved.qid, wikipediaTitle: nameOut, wikivoyageTitle: entity?.wikivoyageTitle || nameOut,
                imageUrl: image?.url || null, imageCredit: image?.credit || null, imageLicense: image?.license || null,
                imageLicenseUrl: image?.licenseUrl || null, imageSourceUrl: image?.sourceUrl || null,
                source: 'wikidata', sourceUrl: `https://www.wikidata.org/wiki/${resolved.qid}`, fetchedAt: now,
            };
            let page = null;
            try { page = await wikivoyage.page(city.wikivoyageTitle); } catch (err) { log.warn(`[Tours discover] Wikivoyage ${nameOut}: ${err.message}`); }
            if (page) {
                city.summary = parseCityPage(page.wikitext, page.title, { districts: 0 }).summary;
                city.wikivoyageTitle = page.title;
            }
            const cityId = await store.upsertCity(city);
            if (page) {
                const pages = [page];
                const districts = parseCityPage(page.wikitext, page.title, { districts: config.openData.districtPages }).districts;
                for (const district of districts) {
                    try {
                        const sub = await wikivoyage.page(district);
                        if (sub) pages.push(sub);
                    } catch (err) { log.warn(`[Tours discover] Wikivoyage ${district}: ${err.message}`); }
                }
                await store.upsertCitySource(cityId, {
                    wikivoyageTitle: page.title, wikitext: JSON.stringify({ pages }),
                    sourceUrl: page.sourceUrl, fetchedAt: page.fetchedAt,
                });
            }
            await s.db.exec(`INSERT INTO tours_city_lookup(query, city_id, expires_at) VALUES ($1,$2,now()+interval '30 days')
                ON CONFLICT(query) DO UPDATE SET city_id=EXCLUDED.city_id, expires_at=EXCLUDED.expires_at`, [key, cityId]);
            const stored = await store.cityById(cityId);
            if (populate) {
                try { await jobs.places.populateCity(stored); } catch (err) { log.warn(`[Tours discover] places ${nameOut}: ${err.message}`); }
            }
            return store.cityById(cityId);
        })().finally(() => pending.delete(`city:${key}`));
        pending.set(`city:${key}`, task);
        return task;
    }

    async function ensurePlace(name) {
        const key = keyOf(name);
        if (key.length < 3 || key.length > 120) return null;
        if (pending.has(`place:${key}`)) return pending.get(`place:${key}`);
        const task = (async () => {
            const hits = await search(name, 3);
            const hit = hits.find((h) => h.osm_type && h.osm_id && h.name && Number.isFinite(Number(h.lat)) && Number.isFinite(Number(h.lon)));
            if (!hit) return null;
            const cityName = hit.address?.city || hit.address?.town || hit.address?.municipality || hit.address?.village;
            if (!cityName) return null;
            const city = await ensureCity(cityName, { populate: false });
            if (!city) return null;
            const tags = { name: hit.name, ...hit.extratags };
            if (!tags.tourism && !tags.leisure) tags[['park', 'garden'].includes(hit.type) ? 'leisure' : 'tourism'] = hit.type || 'attraction';
            const place = placeFromElement({ type: hit.osm_type, id: hit.osm_id, lat: hit.lat, lon: hit.lon, tags }, city.id, new Date().toISOString());
            if (!place) return null;
            const [photographed] = await jobs.places.photosFor([place]);
            const id = await store.upsertPlace(photographed);
            return enrichPlace(await store.placeById(id));
        })().finally(() => pending.delete(`place:${key}`));
        pending.set(`place:${key}`, task);
        return task;
    }

    async function enrichPlace(place) {
        if (!place || place.description || (!place.wikipedia && !place.wikidata_id)) return place;
        try {
            const fromTag = String(place.wikipedia || '').match(/^en:(.{2,120})$/)?.[1] || null;
            const entity = !fromTag && place.wikidata_id ? (await wikidata.entities([place.wikidata_id])).get(place.wikidata_id) : null;
            const title = fromTag || entity?.wikipediaTitle;
            const guide = title ? await wikidata.article(title) : null;
            return guide ? store.updatePlaceGuide(place.id, guide) : place;
        } catch (err) { log.warn(`[Tours discover] Wikipedia ${place.id}: ${err.message}`); return place; }
    }

    return { ensureCity, ensurePlace, enrichPlace, search };
}

module.exports = { createDiscover };
