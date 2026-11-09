'use strict';
const { clipSentences } = require('../places/clip');

/**
 * OpenStreetMap through Overpass: one bounded `around:` query per city, named destinations only.
 * ODbL; every place keeps its openstreetmap.org URL and the query's fetch time. No bulk download.
 */
const { fetchText } = require('./http');
const { isPlace } = require('../places/is-place');

// What a traveller means by "place". Lodging is Rent's; a hotel is not an attraction.
const INTERESTING = new Set(['attraction', 'museum', 'viewpoint', 'gallery', 'zoo', 'theme_park', 'aquarium', 'park', 'garden', 'nature_reserve']);

function overpassQuery(lat, lon, radiusM, tagged = false) {
    const r = Math.max(100, Math.min(25_000, Math.round(Number(radiusM) || 15_000)));
    const group = (wikidata) => {
        const wd = wikidata ? '["wikidata"]' : '';
        return `(nwr["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park)$"]["name"]${wd}(around:${r},${Number(lat)},${Number(lon)});nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"]${wd}(around:${r},${Number(lat)},${Number(lon)}););`;
    };
    // Overpass emits the tagged group in full before the capped general group, in one paced request.
    return `[out:json][timeout:25];${group(true)}out center tags;${tagged ? '' : `${group(false)}out center tags 400;`}`;
}

function commonsImage(tag) {
    const value = String(tag || '').trim();
    if (!value) return null;
    if (/^https:\/\//i.test(value)) return value;
    const file = value.replace(/^File:/i, '').replace(/^Category:/i, '').trim();
    if (!file || /^Category:/i.test(value)) return null;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=1000`;
}

function addressOf(tags) {
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
    return tags['addr:full'] || [street, tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(', ') || null;
}

function placeFromElement(el, cityId, fetchedAt) {
    const tags = el.tags || {};
    const kind = String(tags.tourism || tags.leisure || '').toLowerCase();
    if (!INTERESTING.has(kind) || !tags.name || !isPlace(tags.name, tags)) return null;
    const lat = Number.isFinite(Number(el.lat)) ? Number(el.lat) : Number(el.center && el.center.lat);
    const lon = Number.isFinite(Number(el.lon)) ? Number(el.lon) : Number(el.center && el.center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const osmType = el.type === 'node' ? 'node' : el.type === 'way' ? 'way' : 'relation';
    return {
        cityId,
        osmType,
        osmId: String(el.id),
        name: String(tags.name).slice(0, 200),
        // The English name when OpenStreetMap has one that differs (洪崖洞 → Hongya Cave): shown first and searched.
        nameEn: tags['name:en'] && String(tags['name:en']).trim() && String(tags['name:en']).trim() !== String(tags.name).trim() ? String(tags['name:en']).trim().slice(0, 200) : null,
        kind,
        lat,
        lon,
        address: addressOf(tags),
        website: /^https?:\/\//i.test(tags.website || '') ? tags.website : null,
        openingHours: tags.opening_hours || null,
        wheelchair: ['yes', 'no', 'limited'].includes(tags.wheelchair) ? tags.wheelchair : null,
        fee: ['yes', 'no'].includes(tags.fee) ? tags.fee : null,
        wikidataId: /^Q[1-9][0-9]{0,11}$/.test(tags.wikidata || '') ? tags.wikidata : null,
        wikipedia: tags.wikipedia || null,
        // OSM tags do not carry an image licence or author. The places job resolves these through Commons.
        imageFile: tags.image || tags.wikimedia_commons || null,
        imageUrl: null,
        imageCredit: null,
        imageLicense: null,
        description: tags.description ? clipSentences(tags.description, 800) : null,
        source: 'openstreetmap',
        sourceUrl: `https://www.openstreetmap.org/${osmType}/${el.id}`,
        fetchedAt,
    };
}

function createOverpass({ config, fetchImpl, pace }) {
    async function tourism(lat, lon, radiusM = config.openData.radiusM) {
        const body = new URLSearchParams({ data: overpassQuery(lat, lon, radiusM) }).toString();
        const out = await fetchText(config.upstreams.overpass, {
            fetchImpl, pace, method: 'POST', timeoutMs: config.upstreams.timeoutMs,
            userAgent: config.openData.userAgent, label: 'Overpass',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
        });
        let json;
        try { json = JSON.parse(out.text); }
        catch { throw new Error('Overpass answered something that is not JSON'); }
        const seen = new Set();
        return { elements: (json?.elements || []).filter((el) => {
            const key = `${el.type}:${el.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }), fetchedAt: out.fetchedAt };
    }
    return { tourism, placeFromElement, overpassQuery, INTERESTING };
}

module.exports = { createOverpass, placeFromElement, overpassQuery, commonsImage, INTERESTING };
