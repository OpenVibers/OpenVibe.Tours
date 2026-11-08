'use strict';

/**
 * OpenVibe.Tours' pages in OpenVibe.Search (openvibe-publishing/search-feed, contracts 0.274.0): one
 * search.index-document@1 per place to see (/place/<plc_ id>), city (/city/<slug>, the slug as the id) and self-guided
 * walk (/routes/<rte_ id>), sent as tours.index_document.upserted|deleted through this service's events outbox. Each
 * document is what its page says: a place's kind, city and access facts (free, step-free) and its description; a
 * city's Wikivoyage summary and how many places and walks it has; a walk's stops, distance and time. 2,754 places,
 * 100 cities and 170 walks were on no network search (2026-11-02).
 *
 * The rows come from the source jobs (OpenStreetMap, Wikidata, Wikivoyage), which refresh daily, so a sweep a minute
 * after boot and every six hours is enough: the sequencer (tours_index_revisions) gives an unchanged page its old
 * revision and a quiet sweep sends nothing; a page whose row is gone gets a tombstone. Off under TOURS_DRILL.
 */
const { createServiceOutbox } = require('openvibe-sdk/events');
const { createSearchFeed } = require('openvibe-publishing/search-feed');

const EVENT_TYPES = ['tours.index_document.upserted', 'tours.index_document.deleted'];
const START_DELAY_MS = 60_000;
const INTERVAL_MS = 6 * 3_600_000;

const iso = (t) => (t ? new Date(t).toISOString() : null);
const clip = (text, n) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const kindWord = (kind) => { const k = String(kind || 'place').replace(/_/g, ' '); return k.charAt(0).toUpperCase() + k.slice(1); };

function describePlace(row) {
    const where = [row.city_name, row.country].filter(Boolean).join(', ');
    // The English name first when OpenStreetMap has one (洪崖洞 → "Hongya Cave (洪崖洞)"), so both find the page.
    const title = row.name_en && row.name_en !== row.name ? `${row.name_en} (${row.name})` : row.name;
    const facts = [row.fee === 'no' ? 'Free to visit.' : row.fee === 'yes' ? 'Entry is paid.' : '', row.wheelchair === 'yes' ? 'Step-free.' : row.wheelchair === 'limited' ? 'Partly step-free.' : ''].filter(Boolean);
    const about = `${kindWord(row.kind)} in ${where}.`;
    return {
        listed: true,
        title,
        summary: [about, clip(row.description, 220), ...facts].filter(Boolean).join(' '),
        // The body holds only what the summary does not (Search's snippet reads both, and repeated the first line).
        body: [row.description && row.description.length > 220 ? row.description : '', row.address].filter(Boolean).join('\n'),
        facets: { city: row.city_slug, country: row.country, kind: row.kind },
        authorship: { mode: 'imported' },
        publishedAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
    };
}

function describeCity(row) {
    const places = Number(row.places) || 0;
    const routes = Number(row.routes) || 0;
    const what = `${plural(places, 'place to see', 'places to see')} and ${plural(routes, 'self-guided walk', 'self-guided walks')} on OpenVibe.Tours.`;
    return {
        listed: true,
        noindex: !places && !routes,
        title: `${row.name}, ${row.country}`,
        summary: [clip(row.summary, 260), what].filter(Boolean).join(' '),
        body: [row.region ? `${row.name}, ${row.region}, ${row.country}` : '', row.summary && row.summary.length > 260 ? row.summary : '', 'Things to do, places to see, walks, stays and flights.'].filter(Boolean).join('\n'),
        facets: { city: row.id, country: row.country, places, routes },
        authorship: { mode: 'imported' },
        publishedAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
    };
}

function describeRoute(row) {
    const km = (Number(row.distance_m) || 0) / 1000;
    const shape = [plural(Number(row.stop_count) || 0, 'stop', 'stops'), km ? `${km.toFixed(1)} km` : '', row.duration_min ? `about ${row.duration_min} minutes` : ''].filter(Boolean).join(', ');
    const about = `A self-guided walk in ${row.city_name}, ${row.country}: ${shape}.`;
    return {
        listed: true,
        noindex: !Number(row.stop_count),
        title: row.title,
        summary: [about, clip(row.summary, 220)].filter(Boolean).join(' '),
        body: row.summary && row.summary.length > 220 ? row.summary : '',
        facets: { city: row.city_slug, country: row.country, stops: Number(row.stop_count) || 0, distance_m: Number(row.distance_m) || 0, duration_min: Number(row.duration_min) || 0 },
        authorship: { mode: 'imported' },
        publishedAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
    };
}

function createSearchIndex({ config, s, log = console, outbox = null }) {
    const db = s.db;
    const out = outbox || createServiceOutbox({
        db, source: 'tours', eventsUrl: config.events.url || null, networkInternalUrl: config.networkInternalUrl,
        clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret, log, eventTypes: EVENT_TYPES,
    });
    const page = (sql) => async (after, limit) => db.many(sql, [String(after || ''), limit]);
    const existing = (sql) => async (ids) => (ids.length ? (await db.many(sql, [ids])).map((r) => r.id) : []);
    const feed = createSearchFeed({
        owner: 'tours', db, outbox: out, baseUrl: config.baseUrl, now: s.now, log,
        types: {
            place: {
                page: (row) => require('./store').placePath(row),
                document: describePlace,
                rows: page(`SELECT p.id, p.name, p.name_en, p.kind, p.description, p.address, p.fee, p.wheelchair, p.created_at, p.updated_at,
                                   c.name AS city_name, c.slug AS city_slug, c.country
                              FROM tours_places p JOIN tours_cities c ON c.id = p.city_id
                             WHERE p.id > $1 ORDER BY p.id LIMIT $2`),
                exists: existing('SELECT id FROM tours_places WHERE id = ANY($1::text[])'),
            },
            city: {
                page: (row) => `/city/${row.id}`,
                document: describeCity,
                rows: page(`SELECT c.slug AS id, c.name, c.country, c.region, c.summary, c.created_at, c.updated_at,
                                   (SELECT COUNT(*)::int FROM tours_places p WHERE p.city_id = c.id) AS places,
                                   (SELECT COUNT(*)::int FROM tours_routes r WHERE r.city_id = c.id) AS routes
                              FROM tours_cities c WHERE c.slug > $1 ORDER BY c.slug LIMIT $2`),
                exists: existing('SELECT slug AS id FROM tours_cities WHERE slug = ANY($1::text[])'),
            },
            route: {
                page: (row) => `/routes/${row.id}`,
                document: describeRoute,
                rows: page(`SELECT r.id, r.title, r.summary, r.distance_m, r.duration_min, r.stop_count, r.created_at, r.updated_at,
                                   c.name AS city_name, c.slug AS city_slug, c.country
                              FROM tours_routes r JOIN tours_cities c ON c.id = r.city_id
                             WHERE r.id > $1 ORDER BY r.id LIMIT $2`),
                exists: existing('SELECT id FROM tours_routes WHERE id = ANY($1::text[])'),
            },
        },
    });
    const timers = [];

    async function sweep() {
        const res = await feed.sweep();
        for (const [type, r] of Object.entries(res)) {
            if (r.sent || r.removed || r.failed) log.log(`[Search] ${type}: ${r.sent} sent, ${r.removed} removed, ${r.failed} failed of ${r.seen}`);
        }
        if (out.kick) out.kick().catch(() => {});
        return res;
    }
    const quietly = () => { sweep().catch((err) => log.warn(`[Search] sweep failed: ${(err && err.message) || err}`)); };

    function start() {
        if (config.drill || timers.length) return false;
        out.start();
        const kick = setTimeout(quietly, START_DELAY_MS);
        if (kick.unref) kick.unref();
        const tick = setInterval(quietly, INTERVAL_MS);
        if (tick.unref) tick.unref();
        timers.push(kick, tick);
        return true;
    }

    function stop() {
        for (const t of timers.splice(0)) { clearTimeout(t); clearInterval(t); }
        out.stop();
    }

    return { feed, outbox: out, sweep, start, stop, status: () => out.status() };
}

module.exports = { createSearchIndex, describePlace, describeCity, describeRoute, EVENT_TYPES };
