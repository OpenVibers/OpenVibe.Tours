'use strict';

/**
 * OpenStreetMap through Overpass: one bounded `around:` query per city, tourism=* only, `out center tags`.
 * ODbL; every place keeps its openstreetmap.org URL and the query's fetch time. No bulk download.
 */
const { fetchText } = require('./http');

// What a traveller means by "place". Lodging is Rent's; a hotel is not an attraction.
const INTERESTING = new Set(['attraction', 'museum', 'viewpoint', 'artwork', 'gallery', 'zoo', 'theme_park', 'aquarium', 'information', 'picnic_site', 'botanical_garden']);

function overpassQuery(lat, lon, radiusM) {
    const r = Math.max(100, Math.min(10_000, Math.round(Number(radiusM) || 3500)));
    return `[out:json][timeout:25];nwr["tourism"](around:${r},${Number(lat)},${Number(lon)});out center tags 160;`;
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
    const kind = String(tags.tourism || '').toLowerCase();
    if (!INTERESTING.has(kind) || !tags.name) return null;
    const lat = Number.isFinite(Number(el.lat)) ? Number(el.lat) : Number(el.center && el.center.lat);
    const lon = Number.isFinite(Number(el.lon)) ? Number(el.lon) : Number(el.center && el.center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const osmType = el.type === 'node' ? 'node' : el.type === 'way' ? 'way' : 'relation';
    return {
        cityId,
        osmType,
        osmId: String(el.id),
        name: String(tags.name).slice(0, 200),
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
        imageUrl: commonsImage(tags.image) || commonsImage(tags.wikimedia_commons),
        imageCredit: 'OpenStreetMap contributor',
        imageLicense: null,
        description: tags.description ? String(tags.description).slice(0, 800) : null,
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
        try { json = JSON.parse(out.text); } catch { throw new Error('Overpass answered something that is not JSON'); }
        return { elements: (json && json.elements) || [], fetchedAt: out.fetchedAt };
    }
    return { tourism, placeFromElement, overpassQuery, INTERESTING };
}

module.exports = { createOverpass, placeFromElement, overpassQuery, commonsImage, INTERESTING };
