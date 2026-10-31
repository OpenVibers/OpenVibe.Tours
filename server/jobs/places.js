'use strict';

/**
 * The places job, in two passes:
 *
 *   1. Wikivoyage: every city's stored See listings with coordinates become a cited place (CC BY-SA) unless an
 *      OpenStreetMap place of the same name or within 120 m is already stored. This makes every city populated
 *      even when Overpass is queueing.
 *   2. OpenStreetMap: one bounded `tourism=*` Overpass query for the cities whose OSM data is oldest, limited by
 *      TOURS_OSM_CITIES_PER_RUN so one run never hammers the public instance. ODbL; every place keeps its
 *      openstreetmap.org URL and the fetch time. A failure leaves the previous rows and the Wikivoyage fallback.
 */
const { createOverpass } = require('../sources/osm');
const { parseCityPage } = require('../sources/wikivoyage');
const { stableId } = require('../store');

const R = 6_371_000;
function distanceM(a, b) {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(Number(b.lat) - Number(a.lat));
    const dLon = rad(Number(b.lon) - Number(a.lon));
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(Number(a.lat))) * Math.cos(rad(Number(b.lat))) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function createPlacesJob({ config, s, store, fetchImpl, log = console }) {
    const osm = createOverpass({ config, fetchImpl, pace: s.pace });

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
                listings = listings.concat(p.see.map((x) => ({ ...x, pageUrl: page.sourceUrl || source.source_url })));
            }
        }
        const existing = await store.cityPlaces(city.id, { limit: 200 });
        let n = 0;
        for (const listing of listings) {
            if (!listing.hasCoords || !Number.isFinite(Number(listing.lat)) || !Number.isFinite(Number(listing.lon))) continue;
            const name = String(listing.name || '').trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (existing.some((p) => p.name.toLowerCase() === key || distanceM(p, listing) <= 120)) continue;
            const place = {
                cityId: city.id,
                osmType: 'wikivoyage',
                osmId: stableId('wv', `${city.id}:${key}:${listing.lat}:${listing.lon}`),
                name,
                kind: 'attraction',
                lat: Number(listing.lat),
                lon: Number(listing.lon),
                description: listing.note || null,
                wikidataId: listing.wikidata || null,
                source: 'wikivoyage',
                sourceUrl: listing.pageUrl || source.source_url,
                fetchedAt: source.fetched_at,
            };
            await store.upsertPlace(place);
            existing.push({ name, lat: place.lat, lon: place.lon, id: null });
            n += 1;
        }
        return n;
    }

    async function runOnce({ limit = config.openData.cityLimit, osmLimit = config.openData.osmCitiesPerRun } = {}) {
        const result = { cities: 0, wikivoyagePlaces: 0, places: 0, osmCities: 0, empty: [], errors: [] };

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

        // 2. OpenStreetMap for the cities whose OSM data is oldest, bounded per run.
        const want = Math.min(100, Math.max(0, Number(osmLimit) || 0));
        if (!want) return result;
        const osmCities = await store.citiesForOsm(want);
        for (const [i, city] of osmCities.entries()) {
            try {
                const { elements, fetchedAt } = await osm.tourism(city.lat, city.lon, config.openData.radiusM);
                const seen = new Set();
                const existing = await store.cityPlaces(city.id, { limit: 200 });
                let n = 0;
                for (const el of elements) {
                    if (n >= config.openData.maxPerCity) break;
                    const place = osm.placeFromElement(el, city.id, fetchedAt);
                    if (!place) continue;
                    const key = `${place.osmType}:${place.osmId}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    if (existing.some((p) => p.source === 'wikivoyage' && (p.name.toLowerCase() === place.name.toLowerCase() || distanceM(p, place) <= 120))) continue;
                    await store.upsertPlace(place);
                    n += 1;
                }
                await store.markCityOsmFetched(city.id);
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

    return { runOnce, seedWikivoyage, distanceM };
}

module.exports = { createPlacesJob, distanceM };
