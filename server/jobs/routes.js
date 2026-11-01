'use strict';

/**
 * The routes job: a few self-guided walks per city from Wikivoyage's See lists, marked as generated and cited to
 * the exact Wikivoyage page of every stop. A route needs at least four stops with coordinates; a city with fewer
 * gets none rather than an invented one. There is no speech API today, so every stop's audio_status is "none".
 */
const { parseCityPage } = require('../sources/wikivoyage');
const { stableId } = require('../store');

const R = 6_371_000;
function haversineM(a, b) {
    if (!a || !b) return 0;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

function routeTitle(city, index, count) {
    return index === 0 ? `${city.name}: a self-guided walk` : `${city.name}: more of the See list`;
}

function createRoutesJob({ config, s, store, fetchImpl, log = console }) {
    async function runOnce({ limit = config.openData.cityLimit } = {}) {
        const cities = await store.listCities({ limit });
        const result = { cities: 0, routes: 0, stops: 0, noStops: [], errors: [] };
        result.version = ROUTES_VERSION;
        for (const city of cities) {
            const source = await store.citySource(city.id);
            if (!source) { result.noStops.push(city.slug); continue; }
            let parsed = null;
            try { parsed = JSON.parse(source.wikitext); } catch { parsed = null; }
            let listings = [];
            if (parsed && Array.isArray(parsed.see)) listings = parsed.see;
            else if (parsed && Array.isArray(parsed.pages)) {
                listings = [];
                for (const page of parsed.pages) {
                    const p = parseCityPage(page.wikitext || '', page.title || '', { districts: 0 });
                    listings = listings.concat(p.see.map((x) => ({ ...x, pageUrl: page.sourceUrl || source.source_url })));
                }
            }
            const usable = listings.filter((x) => x && x.hasCoords && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon)));
            // A city with no walk left keeps no routes from an earlier run (they may be the ones this fixes).
            if (usable.length < 4) { await store.replaceRoutesForCity(city.id, []); result.noStops.push(city.slug); continue; }
            const places = await store.cityPlaces(city.id, { limit: 200 });
            const chunks = walksOf(usable, city);
            const routes = [];
            for (const [i, stops] of chunks.entries()) {
                if (stops.length < 4) continue;
                let distance = 0;
                for (let n = 1; n < stops.length; n += 1) distance += haversineM(stops[n - 1], stops[n]);
                const duration = Math.round((distance / 1000 / 4.5) * 60) + stops.length * 5;
                routes.push({
                    id: stableId('rte', `${city.wikidata_id}:see:${i}`),
                    key: `${city.wikidata_id}:see:${i}`,
                    slug: `${city.slug}-see-${i + 1}`,
                    title: routeTitle(city, i, stops.length),
                    summary: `Generated from Wikivoyage's See list for ${city.name}: ${stops.length} stops, about ${(distance / 1000).toFixed(1)} km and ${duration} minutes on foot. Not a guided tour; check each place before you go.`,
                    sourceUrl: source.source_url,
                    fetchedAt: source.fetched_at,
                    distanceM: distance,
                    durationMin: duration,
                    stops: stops.map((stop) => {
                        const exact = places.find((p) => p.name.toLowerCase() === stop.name.toLowerCase());
                        const near = exact || places.find((p) => haversineM(p, stop) <= 250) || null;
                        return {
                            title: stop.name,
                            note: stop.note || `From the Wikivoyage See list for ${city.name}.`,
                            lat: Number(stop.lat),
                            lon: Number(stop.lon),
                            sourceUrl: stop.pageUrl || source.source_url,
                            placeId: near ? near.id : null,
                        };
                    }),
                });
            }
            if (!routes.length) { await store.replaceRoutesForCity(city.id, []); result.noStops.push(city.slug); continue; }
            await store.replaceRoutesForCity(city.id, routes);
            result.cities += 1;
            result.routes += routes.length;
            result.stops += routes.reduce((n, r) => n + r.stops.length, 0);
            if ((result.cities % 10) === 0) log.log(`[Tours routes] ${result.cities} cities, ${result.routes} routes`);
        }
        return result;
    }

    return { runOnce, haversineM, version: ROUTES_VERSION };
}

/**
 * The walks in a See list, as walks (2026-11-01: production showed "Pune: 16623.8 km · 221686 min"). A listing whose
 * coordinates are far from the city (a namesake elsewhere, a typo) is left out; the rest are put in walking order, nearest
 * next, starting from the one closest to the centre; a walk ends at a hop longer than MAX_HOP_M or at MAX_STOPS stops.
 * → [[stop, …], …] each with at least MIN_STOPS stops, at most two walks.
 */
// The walks' rules, by name: a run made under older rules is not fresh, so a deploy that changes them rebuilds every
// route at once instead of in a week (jobs/index.js isFresh).
const ROUTES_VERSION = 'walks-1';
const MAX_FROM_CENTRE_M = 30_000;
const MAX_HOP_M = 8_000;   // a city's See list spans districts: a long hop is a tram ride, a 16 000 km one is a namesake
const MAX_STOPS = 7;
const MIN_STOPS = 4;
function walksOf(listings, centre) {
    const pts = listings.filter((x) => x && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon))).map((x) => ({ ...x, lat: Number(x.lat), lon: Number(x.lon) }));
    if (!pts.length) return [];
    let c = centre && Number.isFinite(Number(centre.lat)) && Number.isFinite(Number(centre.lon)) ? { lat: Number(centre.lat), lon: Number(centre.lon) } : null;
    if (!c) {
        const mid = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
        c = { lat: mid(pts.map((p) => p.lat)), lon: mid(pts.map((p) => p.lon)) };
    }
    const left = pts.filter((p) => haversineM(c, p) <= MAX_FROM_CENTRE_M);
    const walks = [];
    while (left.length >= MIN_STOPS && walks.length < 2) {
        left.sort((a, b) => haversineM(c, a) - haversineM(c, b));
        const walk = [left.shift()];
        while (walk.length < MAX_STOPS && left.length) {
            const here = walk[walk.length - 1];
            let best = 0;
            for (let i = 1; i < left.length; i += 1) if (haversineM(here, left[i]) < haversineM(here, left[best])) best = i;
            if (haversineM(here, left[best]) > MAX_HOP_M) break;
            walk.push(left.splice(best, 1)[0]);
        }
        if (walk.length >= MIN_STOPS) walks.push(walk);
        else if (!walks.length && left.length < MIN_STOPS) break;
    }
    return walks;
}

module.exports = { createRoutesJob, haversineM, routeTitle, walksOf, MAX_HOP_M, MAX_FROM_CENTRE_M };
