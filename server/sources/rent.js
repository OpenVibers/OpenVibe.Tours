'use strict';

/**
 * OpenVibe.Rent's public listings: `GET /api/v1/listings?city=…&limit=…`. Tours reads only; a stay links to the
 * listing on openvibe.rent and never handles a payment. A city with no listing simply has no stays.
 */
const { fetchJson } = require('./http');

function stayOf(row, { fetchedAt, cityId, cityName, rentUrl }) {
    if (!row || !/^rnt_[0-9A-HJKMNP-TV-Z]{26}$/.test(String(row.id || ''))) return null;
    if (!['apartment', 'room', 'house', 'commercial', 'parking', 'equipment', 'other'].includes(row.kind)) return null;
    if (!['month', 'week', 'day', 'hour', 'once'].includes(row.period)) return null;
    if (!/^[A-Z]{3}$/.test(String(row.currency || ''))) return null;
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) return null;
    return {
        externalId: row.id,
        cityId: cityId || null,
        cityName: cityName || row.city || 'Unknown',
        title: String(row.title || 'A place to stay').slice(0, 200),
        kind: row.kind,
        price,
        currency: row.currency,
        period: row.period,
        neighbourhood: row.neighbourhood || null,
        url: `${rentUrl}/listings/${row.id}`,
        fetchedAt,
    };
}

function createRent({ config, fetchImpl, pace }) {
    const opts = { fetchImpl, pace, timeoutMs: config.upstreams.timeoutMs, userAgent: config.openData.userAgent, label: 'OpenVibe.Rent' };

    /** The city's active listings. Rent's own filter is the authority; we never widen it to another city. */
    async function listings(cityName, { cityId = null, limit = 12 } = {}) {
        const city = String(cityName || '').trim();
        if (!city) return { stays: [], fetchedAt: null };
        const url = `${config.upstreams.rent}/api/v1/listings?${new URLSearchParams({ city, limit: String(Math.min(60, Math.max(1, limit))) })}`;
        const { json, fetchedAt } = await fetchJson(url, opts);
        const rows = (json && json.listings) || [];
        return { stays: rows.map((r) => stayOf(r, { fetchedAt, cityId, cityName: city, rentUrl: config.upstreams.rentPublic || 'https://openvibe.rent' })).filter(Boolean), fetchedAt };
    }

    return { listings, stayOf };
}

module.exports = { createRent, stayOf };
