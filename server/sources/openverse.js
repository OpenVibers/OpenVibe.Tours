'use strict';

const { fetchJson } = require('./http');
const ALLOWED = new Set(['by', 'by-sa', 'cc0', 'pdm']);

function asImage(row, query) {
    if (!row || row.mature || !ALLOWED.has(String(row.license || '').toLowerCase())) return null;
    const title = String(row.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const phrase = String(query || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!phrase || !title.includes(phrase) || !row.creator || !row.foreign_landing_url || !row.id) return null;
    const source = String(row.foreign_landing_url);
    const thumb = `https://api.openverse.org/v1/images/${encodeURIComponent(row.id)}/thumb/`;
    if (!/^https:\/\//.test(source) || !/^[0-9a-f-]{36}$/i.test(row.id)) return null;
    const license = String(row.license).toLowerCase();
    return {
        url: thumb, credit: String(row.creator).slice(0, 250),
        license: license === 'pdm' ? 'PDM' : license === 'cc0' ? 'CC0' : `CC ${license.toUpperCase()} ${String(row.license_version || '').trim()}`.trim(),
        licenseUrl: row.license_url || null, sourceUrl: source, provider: 'openverse',
    };
}

function createOpenverse({ config, fetchImpl, pace }) {
    async function image(name) {
        const q = String(name || '').trim().slice(0, 100);
        if (q.length < 3) return null;
        const url = `${config.upstreams.openverse}/v1/images/?${new URLSearchParams({ q, license: 'by,by-sa,cc0,pdm', mature: 'false', page_size: '5' })}`;
        const { json } = await fetchJson(url, { fetchImpl, pace, timeoutMs: Math.min(config.upstreams.timeoutMs, 10_000),
            userAgent: config.openData.userAgent, label: 'Openverse', retries: 0 });
        return ((json && json.results) || []).map((r) => asImage(r, q)).find(Boolean) || null;
    }
    return { image };
}

module.exports = { createOpenverse, asImage };
