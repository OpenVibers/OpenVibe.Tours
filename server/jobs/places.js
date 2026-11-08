'use strict';

/**
 * The places job, in two passes:
 *
 *   1. Wikivoyage: every city's stored See and Do listings with coordinates become a cited place (CC BY-SA) unless an
 *      OpenStreetMap place of the same name or within 120 m is already stored. This makes every city populated
 *      even when Overpass is queueing.
 *   2. OpenStreetMap: one bounded, named-destination Overpass query for the cities whose OSM data is oldest, limited by
 *      TOURS_OSM_CITIES_PER_RUN so one run never hammers the public instance. ODbL; every place keeps its
 *      openstreetmap.org URL and the fetch time. A failure leaves the previous rows and the Wikivoyage fallback.
 */
const { createOverpass } = require('../sources/osm');
const { createWikidata } = require('../sources/wikidata');
const { createPhotoCache } = require('../places/photo-cache');
const { createOpenverse } = require('../sources/openverse');
const { fetchJson } = require('../sources/http');
const { parseCityPage } = require('../sources/wikivoyage');
const { stableId } = require('../store');
const { isPlace } = require('../places/is-place');

// A run under older rules is not fresh (jobs/index.js): name-en-1 stored OpenStreetMap's English names; wv-text-1
// rewrites the stored Wikivoyage places' text with the current parser.
const PLACES_VERSION = 'notable-places-3-photo-pass';   // 11-08: the first boot runs the photo pass at once

function commonsFile(value) {
    const raw = String(value || '').trim();
    if (/^(?:File|Image):/i.test(raw)) return `File:${raw.replace(/^(?:File|Image):/i, '')}`;
    if (/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/i.test(raw)) return `File:${decodeURIComponent(raw.split('/wiki/File:')[1]).replace(/_/g, ' ')}`;
    return null;
}

const R = 6_371_000;
function distanceM(a, b) {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(Number(b.lat) - Number(a.lat));
    const dLon = rad(Number(b.lon) - Number(a.lon));
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(Number(a.lat))) * Math.cos(rad(Number(b.lat))) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function rankPlace(place, entity, views = 0) {
    return (place.source === 'wikivoyage' ? 300 : 0)
        + Math.min(1000, Number(entity?.sitelinks || 0)) * 20
        + Math.round(Math.log10(Math.max(0, views) + 1) * 1000)
        + (place.imageUrl ? 500 : 0) + (place.description ? 200 : 0);
}

function whyAfterLead(text) {
    const sentences = String(text || '').match(/[^.!?]+[.!?]+(?:\s|$)/g)?.map((s) => s.trim()) || [];
    return sentences.slice(1, 4).join(' ').slice(0, 600) || null;
}

function createPlacesJob({ config, s, store, fetchImpl, log = console }) {
    const osm = createOverpass({ config, fetchImpl, pace: s.pace });
    const wikidata = createWikidata({ config, fetchImpl, pace: s.pace, log });
    const photoCache = createPhotoCache({ config, s, fetchImpl, log });
    const openverse = createOpenverse({ config, fetchImpl, pace: s.pace });

    async function pageviewsFor(entities) {
        const out = new Map();
        if (config.drill) return out;
        const ranked = [...entities.values()].filter((e) => e.wikipediaTitle)
            .sort((a, b) => b.sitelinks - a.sitelinks).slice(0, 5);
        const today = new Date();
        const month = `${new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)).toISOString().slice(0, 7).replace('-', '')}0100`;
        for (const entity of ranked) {
            const title = entity.wikipediaTitle;
            const cached = await s.db.maybe(`SELECT views FROM tours_pageview_cache WHERE wikipedia_title=$1 AND fetched_at > now()-interval '7 days'`, [title]);
            if (cached) { out.set(entity.qid, Number(cached.views)); continue; }
            try {
                const path = encodeURIComponent(title.replace(/ /g, '_'));
                const { json } = await fetchJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${path}/monthly/${month}/${month}`,
                    { fetchImpl, pace: s.pace, userAgent: config.openData.userAgent, timeoutMs: 8000, retries: 0, label: 'Wikimedia pageviews' });
                const views = Math.max(0, Number(json?.items?.[0]?.views) || 0);
                out.set(entity.qid, views);
                await s.db.exec(`INSERT INTO tours_pageview_cache(wikipedia_title, views) VALUES ($1,$2)
                    ON CONFLICT(wikipedia_title) DO UPDATE SET views=EXCLUDED.views, fetched_at=now()`, [title, views]);
            } catch { /* Sitelinks still provide a stable notability signal. */ }
        }
        return out;
    }

    async function photosFor(places) {
        const qids = places.map((p) => p.wikidataId).filter(Boolean);
        const entities = qids.length ? await wikidata.entities(qids) : new Map();
        const pageviews = await pageviewsFor(entities);
        const files = places.map((p) => {
            const p18 = entities.get(p.wikidataId)?.image;
            return commonsFile(p.imageFile) || (p18 ? commonsFile(p18) || `File:${p18}` : null);
        });
        const galleries = new Map();
        for (let i = 0, searched = 0; i < places.length && searched < 5; i++) {
            const category = /^Category:/i.test(String(places[i].imageFile || ''))
                ? places[i].imageFile : entities.get(places[i].wikidataId)?.commonsCategory;
            if (!category) continue;
            searched += 1;
            try {
                const found = (await wikidata.categoryFiles(category)).slice(0, 3);
                galleries.set(i, found);
                if (!files[i]) files[i] = found[0] || null;
            } catch { /* no verified photo */ }
        }
        const images = await wikidata.imageInfo([...files.filter(Boolean), ...[...galleries.values()].flat()]);
        let fallbacks = 0;
        return Promise.all(places.map(async (p, i) => {
            let image = images.get(files[i]) || (galleries.get(i) || []).map((file) => images.get(file)).find(Boolean);
            if (!image && !config.drill && fallbacks < 3) {
                fallbacks += 1;
                try { image = await openverse.image(p.name); } catch { /* no verified photo */ }
            }
            const cached = image ? await photoCache.cache(image) : null;
            // A photo exists but its copy failed (Media busy, a timeout): not "no photo", so it is tried again next run.
            const deferred = !!image && !cached;
            const gallery = [];
            for (const file of galleries.get(i) || []) {
                const candidate = images.get(file);
                if (!candidate || candidate.sourceUrl === cached?.sourceUrl) continue;
                const photo = await photoCache.cache(candidate);
                if (photo) gallery.push({ url: photo.url, credit: photo.credit, license: photo.license,
                    licenseUrl: photo.licenseUrl, sourceUrl: photo.sourceUrl });
            }
            const pictured = cached ? { ...p, imageUrl: cached.url, imageCredit: cached.credit,
                imageLicense: cached.license, imageLicenseUrl: cached.licenseUrl, imageSourceUrl: cached.sourceUrl, gallery } : p;
            return { ...pictured, ...(deferred ? { photoDeferred: true } : {}), rankScore: Math.max(Number(p.rankScore) || 0,
                rankPlace(pictured, entities.get(p.wikidataId), pageviews.get(p.wikidataId) || 0)) };
        }));
    }

    async function seedWikivoyage(city) {
        const source = await store.citySource(city.id);
        if (!source) return 0;
        let parsed = null;
        try { parsed = JSON.parse(source.wikitext); } catch { parsed = null; }
        let listings = [];
        if (parsed && Array.isArray(parsed.see)) listings = parsed.see;
        else if (parsed && Array.isArray(parsed.pages)) {
            for (const page of parsed.pages) {
                const p = parseCityPage(page.wikitext || '', page.title || '', { districts: 0 });
                listings = listings.concat([...p.see, ...p.do].map((x) => ({ ...x, pageUrl: page.sourceUrl || source.source_url })));
            }
        }
        const existing = await store.cityPlaces(city.id, { limit: 200 });
        let n = 0;
        const prepared = await photosFor(listings.filter((x) => x.wikidata).map((x) => ({ wikidataId: x.wikidata })));
        const photos = new Map(listings.filter((x) => x.wikidata).map((x, i) => [x.wikidata, prepared[i]]));
        for (const listing of listings) {
            if (!listing.hasCoords || !Number.isFinite(Number(listing.lat)) || !Number.isFinite(Number(listing.lon))) continue;
            const name = String(listing.name || '').trim();
            if (!name || !isPlace(name)) continue;
            const key = name.toLowerCase();
            const osmId = stableId('wv', `${city.id}:${key}:${listing.lat}:${listing.lon}`);
            // A Wikivoyage place already stored is written again, so its text follows the parser (a description stored
            // before {{acre|107}} was read kept "Covering , the court complex", 2026-11-02); any other place near or
            // of the same name still wins.
            const same = existing.some((p) => p.osm_type === 'wikivoyage' && p.osm_id === osmId);
            if (!same && existing.some((p) => p.name.toLowerCase() === key || distanceM(p, listing) <= 120)) continue;
            const place = {
                cityId: city.id,
                osmType: 'wikivoyage',
                osmId,
                name,
                kind: 'attraction',
                lat: Number(listing.lat),
                lon: Number(listing.lon),
                description: listing.note || null,
                guideWhy: whyAfterLead(listing.note),
                wikidataId: listing.wikidata || null,
                source: 'wikivoyage',
                sourceUrl: listing.pageUrl || source.source_url,
                fetchedAt: source.fetched_at,
                ...photos.get(listing.wikidata),
            };
            place.rankScore = (place.rankScore || 0) + 300;
            await store.upsertPlace(place);
            existing.push({ name, lat: place.lat, lon: place.lon, id: null });
            n += 1;
        }
        return n;
    }

    async function seedWikidata(city) {
        if (!city.wikidata_id) return 0;
        const cached = await s.db.maybe(`SELECT payload FROM tours_wikidata_city_places
            WHERE city_id=$1 AND fetched_at > now()-interval '7 days'`, [city.id]);
        let found = cached?.payload;
        if (typeof found === 'string') found = JSON.parse(found);
        if (!Array.isArray(found)) {
            found = await wikidata.notablePlaces(city.wikidata_id);
            await s.db.exec(`INSERT INTO tours_wikidata_city_places(city_id,payload) VALUES ($1,$2::jsonb)
                ON CONFLICT(city_id) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=now()`, [city.id, JSON.stringify(found)]);
        }
        const existing = await store.cityPlaces(city.id, { limit: 200 });
        const candidates = found.filter((x) => !existing.some((p) => p.wikidata_id === x.qid ||
            p.name.toLowerCase() === x.name.toLowerCase() || distanceM(p, x) <= 120)).map((x) => ({
            cityId: city.id, osmType: 'wikidata', osmId: x.qid, wikidataId: x.qid,
            name: x.name, kind: 'attraction', lat: x.lat, lon: x.lon,
            rankScore: Math.min(1000, x.sitelinks) * 20,
            source: 'wikidata', sourceUrl: x.sourceUrl, fetchedAt: x.fetchedAt,
        }));
        const photographed = await photosFor(candidates);
        for (const place of photographed) await store.upsertPlace(place);
        return photographed.length;
    }

    async function populateCity(city) {
        const seeded = await seedWikivoyage(city);
        let notable = 0;
        try { notable = await seedWikidata(city); }
        catch (err) { log.warn(`[Tours places] Wikidata ${city.slug}: ${err.message}`); }
        if (city.osm_fetched_at && Date.now() - new Date(city.osm_fetched_at).getTime() < 7 * 86_400_000) return { seeded, notable, osm: 0 };
        await store.markCityOsmAttempted(city.id);
        const { elements, fetchedAt } = await osm.tourism(city.lat, city.lon, config.openData.radiusM);
        const existing = await store.cityPlaces(city.id, { limit: 200 });
        const seen = new Set();
        const candidates = elements.map((el) => osm.placeFromElement(el, city.id, fetchedAt)).filter(Boolean);
        const photographed = await photosFor(candidates);
        let count = 0;
        let ordinaryCount = 0;
        for (const place of photographed.sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0))) {
            if (!place.wikidataId && ordinaryCount >= config.openData.maxPerCity) continue;
            const key = `${place.osmType}:${place.osmId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (existing.some((p) => p.source === 'wikivoyage' && (p.name.toLowerCase() === place.name.toLowerCase() || distanceM(p, place) <= 120))) continue;
            await store.upsertPlace(place);
            count += 1;
            if (!place.wikidataId) ordinaryCount += 1;
        }
        await store.markCityOsmFetched(city.id);
        return { seeded, notable, osm: count };
    }

    async function runOnce({ limit = config.openData.cityLimit, osmLimit = config.openData.osmCitiesPerRun } = {}) {
        const result = { cities: 0, wikivoyagePlaces: 0, places: 0, osmCities: 0, empty: [], errors: [], version: PLACES_VERSION };

        // 1. Wikivoyage places for every city (fast, cited, no external request).
        const cities = await store.listCities({ limit: Math.max(1, Math.min(100, Number(limit) || 100)) });
        for (const city of cities) {
            try {
                result.wikivoyagePlaces += await seedWikivoyage(city);
                result.cities += 1;
            } catch (err) {
                result.errors.push(`wikivoyage ${city.slug}: ${err && err.message}`);
            }
        }

        // 1b. Places stored without a photo (a copy refused on 11-08, or a photo added to Commons since): a bounded
        // batch per run, tried again after a week.
        try {
            const bare = await store.placesWithoutPhoto({ limit: 60 });
            if (bare.length) {
                const pictured = await photosFor(bare.map((r) => ({ id: r.id, wikidataId: r.wikidata_id, name: r.name })));
                result.photos = 0;
                for (const p of pictured) {
                    if (p.photoDeferred) { result.photosDeferred = (result.photosDeferred || 0) + 1; continue; }
                    if (await store.setPlacePhoto(p.id, p)) result.photos += 1;
                }
            }
        } catch (err) {
            result.errors.push(`photos: ${err && err.message}`);
        }

        // 2. OpenStreetMap for the cities whose OSM data is oldest, bounded per run.
        const want = Math.min(100, Math.max(0, Number(osmLimit) || 0));
        if (!want) return result;
        const osmCities = await store.citiesForOsm(want);
        for (const [i, city] of osmCities.entries()) {
            try {
                const filled = await populateCity(city);
                const n = filled.osm;
                result.places += n;
                result.osmCities += 1;
                if (!n) result.empty.push(city.slug);
            } catch (err) {
                result.errors.push(`${city.slug}: ${err && err.message}`);
                log.warn(`[Tours places] ${city.slug}: ${err && err.message}`);
            }
            if ((i + 1) % 5 === 0) log.log(`[Tours places] OSM ${i + 1}/${osmCities.length} (${result.places} places)`);
        }
        return result;
    }

    return { runOnce, seedWikivoyage, populateCity, photosFor, distanceM, version: PLACES_VERSION };
}

module.exports = { createPlacesJob, distanceM, rankPlace };
