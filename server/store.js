'use strict';

/**
 * Tours' data: the open place database (cities, places, routes and their stops), the Live/VOD and Rent rows the
 * jobs refresh, the job receipts the home shows, and a person's trips.
 *
 * Source rows carry their source URL and fetch time. A trip belongs to one Network subject; only its owner can
 * change it, and only a shared trip is readable by anyone else. No row holds a token.
 */
const crypto = require('crypto');
const { ids } = require('openvibe-contracts');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUBJECT_RE = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;
const VISIBILITIES = Object.freeze(['private', 'shared']);
const LIVE_KINDS = Object.freeze(['stream', 'vod', 'clip']);

/** A stable id from a natural key, so re-running a source job updates the same page instead of orphaning it. */
function stableId(prefix, key) {
    const h = crypto.createHash('sha256').update(String(key)).digest();
    let out = '';
    for (let i = 0; i < 26; i += 1) out += ALPHABET[h[i] % 32];
    return `${prefix}_${out}`;
}

function slugify(value) {
    return String(value == null ? '' : value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}

const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)));
const day = (v) => (v == null ? null : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)));
const num = (v) => (v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const int = (v, def = 0) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);
const clean = (v, max = 1000) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const refusal = (status, code, message) => ({ ok: false, status, code, message });
const isIsoDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function wireCity(row) {
    if (!row) return null;
    return {
        id: row.id, slug: row.slug, name: row.name, country: row.country, country_code: row.country_code || null,
        region: row.region || null, lat: num(row.lat), lon: num(row.lon), population: row.population == null ? null : Number(row.population),
        wikidata_id: row.wikidata_id, wikipedia_title: row.wikipedia_title || null, wikivoyage_title: row.wikivoyage_title || null,
        summary: row.summary || null, image_url: row.image_url || null, image_credit: row.image_credit || null,
        image_license: row.image_license || null, image_license_url: row.image_license_url || null,
        source: row.source, source_url: row.source_url, fetched_at: iso(row.fetched_at),
        created_at: iso(row.created_at), updated_at: iso(row.updated_at),
        ...(row.place_count != null ? { place_count: Number(row.place_count) } : {}),
        ...(row.route_count != null ? { route_count: Number(row.route_count) } : {}),
    };
}

function wirePlace(row) {
    if (!row) return null;
    return {
        id: row.id, city_id: row.city_id, city_slug: row.city_slug || null, city_name: row.city_name || null,
        osm_type: row.osm_type, osm_id: row.osm_id, name: row.name, kind: row.kind, lat: num(row.lat), lon: num(row.lon),
        address: row.address || null, website: row.website || null, opening_hours: row.opening_hours || null,
        wheelchair: row.wheelchair || null, fee: row.fee || null, wikidata_id: row.wikidata_id || null,
        wikipedia: row.wikipedia || null, image_url: row.image_url || null, image_credit: row.image_credit || null,
        image_license: row.image_license || null, description: row.description || null,
        source: row.source, source_url: row.source_url, fetched_at: iso(row.fetched_at),
        osm_url: row.osm_type === 'wikivoyage' ? null : `https://www.openstreetmap.org/${row.osm_type}/${row.osm_id}`,
        map_url: `https://www.openstreetmap.org/?mlat=${row.lat}&mlon=${row.lon}#map=16/${row.lat}/${row.lon}`,
    };
}

function wireRoute(row, extra = {}) {
    if (!row) return null;
    return {
        id: row.id, city_id: row.city_id, city_slug: row.city_slug || null, city_name: row.city_name || null,
        slug: row.slug, title: row.title, summary: row.summary || null, source: row.source, source_url: row.source_url,
        fetched_at: iso(row.fetched_at), distance_m: Number(row.distance_m) || 0, duration_min: Number(row.duration_min) || 0,
        stop_count: Number(row.stop_count) || 0, generated: row.generated !== false,
        created_at: iso(row.created_at), updated_at: iso(row.updated_at), ...extra,
    };
}

function wireStop(row) {
    if (!row) return null;
    return {
        position: Number(row.position), place_id: row.place_id || null, title: row.title, note: row.note || null,
        lat: num(row.lat), lon: num(row.lon), source: row.source, source_url: row.source_url,
        audio_status: row.audio_status || 'none', audio_url: row.audio_url || null,
        map_url: `https://www.openstreetmap.org/?mlat=${row.lat}&mlon=${row.lon}#map=17/${row.lat}/${row.lon}`,
    };
}

function wireLive(row) {
    if (!row) return null;
    return {
        id: row.id, kind: row.kind, external_id: row.external_id, username: row.username, display_name: row.display_name || null,
        title: row.title, category: row.category || null, thumbnail_url: row.thumbnail_url || null,
        viewer_count: Number(row.viewer_count) || 0, city_id: row.city_id || null, city_name: row.city_name || null,
        url: row.url, started_at: iso(row.started_at), ended_at: iso(row.ended_at), fetched_at: iso(row.fetched_at),
    };
}

function wireStay(row) {
    if (!row) return null;
    return {
        id: row.id, external_id: row.external_id, city_id: row.city_id || null, city_name: row.city_name,
        title: row.title, kind: row.kind, price: num(row.price), currency: row.currency, period: row.period,
        neighbourhood: row.neighbourhood || null, url: row.url, fetched_at: iso(row.fetched_at),
    };
}

function wireTrip(row) {
    if (!row) return null;
    return {
        id: row.id, slug: row.slug, title: row.title, city_id: row.city_id || null,
        starts_on: day(row.starts_on), ends_on: day(row.ends_on), notes: row.notes || null,
        visibility: row.visibility, revision: Number(row.revision) || 1,
        created_at: iso(row.created_at), updated_at: iso(row.updated_at),
    };
}

function createStore(s, { config = {} } = {}) {
    const db = s.db;
    const q = (t) => t || db;

    // ── Cities ──────────────────────────────────────────────
    async function listCities({ limit = 100, offset = 0, q: query = null } = {}) {
        const lim = Math.min(200, Math.max(1, int(limit, 100)));
        const off = Math.max(0, int(offset, 0));
        const term = query ? `%${clean(query, 80).replace(/[%_]/g, '')}%` : null;
        const rows = await db.many(`
            SELECT c.*,
                   (SELECT COUNT(*) FROM tours_places p WHERE p.city_id = c.id)::int AS place_count,
                   (SELECT COUNT(*) FROM tours_routes r WHERE r.city_id = c.id)::int AS route_count
            FROM tours_cities c
            ${term ? 'WHERE c.name ILIKE $3 OR c.country ILIKE $3' : ''}
            ORDER BY c.population DESC NULLS LAST, c.name
            LIMIT $1 OFFSET $2`, term ? [lim, off, term] : [lim, off]);
        return rows.map(wireCity);
    }

    async function cityBySlug(slug) {
        const row = await db.maybe(`
            SELECT c.*,
                   (SELECT COUNT(*) FROM tours_places p WHERE p.city_id = c.id)::int AS place_count,
                   (SELECT COUNT(*) FROM tours_routes r WHERE r.city_id = c.id)::int AS route_count
            FROM tours_cities c WHERE c.slug = $1`, [String(slug || '')]);
        return wireCity(row);
    }

    async function cityPlaces(cityId, { limit = 60 } = {}) {
        const rows = await db.many(`SELECT p.*, c.slug AS city_slug, c.name AS city_name
            FROM tours_places p JOIN tours_cities c ON c.id = p.city_id
            WHERE p.city_id = $1 ORDER BY p.kind, p.name LIMIT $2`, [String(cityId), Math.min(200, Math.max(1, int(limit, 60)))]);
        return rows.map(wirePlace);
    }

    async function cityRoutes(cityId) {
        const rows = await db.many(`SELECT r.*, c.slug AS city_slug, c.name AS city_name
            FROM tours_routes r JOIN tours_cities c ON c.id = r.city_id
            WHERE r.city_id = $1 ORDER BY r.stop_count DESC, r.id`, [String(cityId)]);
        return rows.map((r) => wireRoute(r));
    }

    async function citiesForOsm(limit = 10) {
        return await db.many(`SELECT id, slug, name, lat, lon FROM tours_cities
            WHERE osm_fetched_at IS NULL OR osm_fetched_at < now() - interval '7 days'
            ORDER BY population DESC NULLS LAST, id LIMIT $1`, [Math.min(100, Math.max(0, int(limit, 10)))]);
    }

    async function markCityOsmFetched(cityId) {
        await db.exec('UPDATE tours_cities SET osm_fetched_at = now() WHERE id = $1', [String(cityId)]);
    }

    async function cityLive(cityId) {
        const rows = await db.many(`SELECT * FROM tours_live WHERE city_id = $1 ORDER BY kind, fetched_at DESC LIMIT 12`, [String(cityId)]);
        return rows.map(wireLive);
    }

    async function cityStays(cityId) {
        const rows = await db.many(`SELECT * FROM tours_stays WHERE city_id = $1 ORDER BY price LIMIT 12`, [String(cityId)]);
        return rows.map(wireStay);
    }

    // ── Places and routes ───────────────────────────────────
    async function placeById(id) {
        const row = await db.maybe(`SELECT p.*, c.slug AS city_slug, c.name AS city_name
            FROM tours_places p JOIN tours_cities c ON c.id = p.city_id WHERE p.id = $1`, [String(id || '')]);
        return wirePlace(row);
    }

    async function routeById(id) {
        const row = await db.maybe(`SELECT r.*, c.slug AS city_slug, c.name AS city_name
            FROM tours_routes r JOIN tours_cities c ON c.id = r.city_id WHERE r.id = $1`, [String(id || '')]);
        if (!row) return null;
        const stops = await db.many('SELECT * FROM tours_route_stops WHERE route_id = $1 ORDER BY position', [row.id]);
        return wireRoute(row, { stops: stops.map(wireStop) });
    }

    async function routesForPlace(placeId) {
        const rows = await db.many(`SELECT DISTINCT r.*, c.slug AS city_slug, c.name AS city_name
            FROM tours_route_stops s JOIN tours_routes r ON r.id = s.route_id JOIN tours_cities c ON c.id = r.city_id
            WHERE s.place_id = $1 ORDER BY r.city_id, r.id`, [String(placeId || '')]);
        return rows.map((r) => wireRoute(r));
    }

    async function routes({ limit = 12, cityId = null } = {}) {
        const rows = cityId
            ? await db.many(`SELECT r.*, c.slug AS city_slug, c.name AS city_name FROM tours_routes r JOIN tours_cities c ON c.id = r.city_id
                WHERE r.city_id = $1 ORDER BY r.stop_count DESC, r.id LIMIT $2`, [cityId, Math.min(100, Math.max(1, int(limit, 12)))])
            : await db.many(`SELECT r.*, c.slug AS city_slug, c.name AS city_name FROM tours_routes r JOIN tours_cities c ON c.id = r.city_id
                ORDER BY r.stop_count DESC, r.id LIMIT $1`, [Math.min(100, Math.max(1, int(limit, 12)))]);
        return rows.map((r) => wireRoute(r));
    }

    /** The same place for everyone for a whole UTC day; no model call, no personalisation. */
    async function placeOfTheDay(dateKey) {
        const row = await db.maybe(`SELECT p.*, c.slug AS city_slug, c.name AS city_name
            FROM tours_places p JOIN tours_cities c ON c.id = p.city_id
            ORDER BY (p.image_url IS NOT NULL) DESC, (p.description IS NOT NULL) DESC, md5($1 || p.id) LIMIT 1`, [String(dateKey || new Date(s.now()).toISOString().slice(0, 10))]);
        return wirePlace(row);
    }

    // ── Live and stays ──────────────────────────────────────
    async function liveNow({ limit = 24 } = {}) {
        const rows = await db.many(`SELECT * FROM tours_live WHERE kind = 'stream' ORDER BY viewer_count DESC, fetched_at DESC LIMIT $1`,
            [Math.min(100, Math.max(1, int(limit, 24)))]);
        return rows.map(wireLive);
    }

    async function recentTours({ limit = 12 } = {}) {
        const rows = await db.many(`SELECT * FROM tours_live WHERE kind IN ('vod', 'clip') ORDER BY COALESCE(ended_at, fetched_at) DESC LIMIT $1`,
            [Math.min(100, Math.max(1, int(limit, 12)))]);
        return rows.map(wireLive);
    }

    async function stays({ limit = 12, cityId = null } = {}) {
        const rows = cityId
            ? await db.many('SELECT * FROM tours_stays WHERE city_id = $1 ORDER BY price LIMIT $2', [cityId, Math.min(100, Math.max(1, int(limit, 12)))])
            : await db.many('SELECT * FROM tours_stays ORDER BY fetched_at DESC, price LIMIT $1', [Math.min(100, Math.max(1, int(limit, 12)))]);
        return rows.map(wireStay);
    }

    // ── Counts, jobs and discovery ──────────────────────────
    async function counts() {
        const row = await db.maybe(`SELECT
            (SELECT COUNT(*)::int FROM tours_cities) AS cities,
            (SELECT COUNT(*)::int FROM tours_places) AS places,
            (SELECT COUNT(*)::int FROM tours_routes) AS routes,
            (SELECT COUNT(*)::int FROM tours_live WHERE kind = 'stream') AS live,
            (SELECT COUNT(*)::int FROM tours_live WHERE kind IN ('vod', 'clip')) AS vods,
            (SELECT COUNT(*)::int FROM tours_stays) AS stays`);
        return row || { cities: 0, places: 0, routes: 0, live: 0, vods: 0, stays: 0 };
    }

    async function latestJobRuns() {
        return await db.many(`SELECT DISTINCT ON (job) job, status, counts, error, finished_at
            FROM tours_job_runs ORDER BY job, started_at DESC`);
    }

    async function recordJobStart(job) {
        const row = await db.maybe(`INSERT INTO tours_job_runs (job, started_at, status) VALUES ($1, now(), 'running') RETURNING id`,
            [String(job)]);
        return row ? Number(row.id) : null;
    }

    async function recordJobFinish(id, { status = 'ok', counts: c = {}, error = null } = {}) {
        if (id == null) return;
        await db.exec(`UPDATE tours_job_runs SET finished_at = now(), status = $2, counts = $3::jsonb, error = $4 WHERE id = $1`,
            [id, ['ok', 'partial', 'failed'].includes(status) ? status : 'partial', JSON.stringify(c || {}), error ? String(error).slice(0, 2000) : null]);
    }

    async function publicCitiesForSitemap(limit = 500) {
        return await db.many('SELECT slug, updated_at FROM tours_cities ORDER BY population DESC NULLS LAST LIMIT $1', [limit]);
    }
    async function publicRoutesForSitemap(limit = 5000) {
        return await db.many('SELECT id, updated_at FROM tours_routes ORDER BY id LIMIT $1', [limit]);
    }
    async function publicPlacesForSitemap(limit = 20000) {
        return await db.many('SELECT id, updated_at FROM tours_places ORDER BY id LIMIT $1', [limit]);
    }
    async function publicCitiesForLlms(limit = 200) {
        return await db.many('SELECT slug, name, country, summary FROM tours_cities ORDER BY population DESC NULLS LAST LIMIT $1', [limit]);
    }

    // ── Job upserts ─────────────────────────────────────────
    async function upsertCity(c) {
        const id = stableId('cty', c.wikidataId);
        const slug = c.slug || slugify(c.name);
        await db.exec(`INSERT INTO tours_cities
            (id, slug, name, country, country_code, region, lat, lon, population, wikidata_id, wikipedia_title, wikivoyage_title,
             summary, image_url, image_credit, image_license, image_license_url, source, source_url, fetched_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now())
            ON CONFLICT (id) DO UPDATE SET
              slug = EXCLUDED.slug, name = EXCLUDED.name, country = EXCLUDED.country, country_code = EXCLUDED.country_code,
              region = EXCLUDED.region, lat = EXCLUDED.lat, lon = EXCLUDED.lon, population = EXCLUDED.population,
              wikidata_id = EXCLUDED.wikidata_id, wikipedia_title = EXCLUDED.wikipedia_title, wikivoyage_title = EXCLUDED.wikivoyage_title,
              summary = COALESCE(EXCLUDED.summary, tours_cities.summary), image_url = EXCLUDED.image_url,
              image_credit = EXCLUDED.image_credit, image_license = EXCLUDED.image_license, image_license_url = EXCLUDED.image_license_url,
              source = EXCLUDED.source, source_url = EXCLUDED.source_url, fetched_at = EXCLUDED.fetched_at, updated_at = now()`,
        [id, slug, clean(c.name, 120), clean(c.country, 120), c.countryCode || null, c.region ? clean(c.region, 120) : null,
            Number(c.lat), Number(c.lon), c.population == null ? null : Number(c.population), c.wikidataId,
            c.wikipediaTitle || null, c.wikivoyageTitle || null, c.summary ? clean(c.summary, 1200) : null,
            c.imageUrl || null, c.imageCredit ? clean(c.imageCredit, 250) : null, c.imageLicense ? clean(c.imageLicense, 120) : null,
            c.imageLicenseUrl || null, c.source || 'wikidata', c.sourceUrl, new Date(c.fetchedAt || s.now()).toISOString()]);
        return id;
    }

    async function upsertCitySource(cityId, { wikivoyageTitle, wikitext, sourceUrl, fetchedAt }) {
        await db.exec(`INSERT INTO tours_city_sources (city_id, wikivoyage_title, wikitext, source_url, fetched_at)
            VALUES ($1,$2,$3,$4,$5) ON CONFLICT (city_id) DO UPDATE SET
              wikivoyage_title = EXCLUDED.wikivoyage_title, wikitext = EXCLUDED.wikitext,
              source_url = EXCLUDED.source_url, fetched_at = EXCLUDED.fetched_at`,
        [cityId, String(wikivoyageTitle), String(wikitext), sourceUrl, new Date(fetchedAt || s.now()).toISOString()]);
    }

    async function citySourcesMissing() {
        return await db.many(`SELECT c.id, c.slug, c.name, c.wikivoyage_title, c.source_url FROM tours_cities c
            LEFT JOIN tours_city_sources s ON s.city_id = c.id WHERE s.city_id IS NULL ORDER BY c.population DESC NULLS LAST`);
    }

    async function citySource(cityId) {
        return await db.maybe('SELECT * FROM tours_city_sources WHERE city_id = $1', [String(cityId)]);
    }

    async function upsertPlace(p) {
        const id = stableId('plc', `${p.osmType}:${p.osmId}`);
        await db.exec(`INSERT INTO tours_places
            (id, city_id, osm_type, osm_id, name, kind, lat, lon, address, website, opening_hours, wheelchair, fee,
             wikidata_id, wikipedia, image_url, image_credit, image_license, description, source, source_url, fetched_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())
            ON CONFLICT (osm_type, osm_id) DO UPDATE SET
              city_id = EXCLUDED.city_id, name = EXCLUDED.name, kind = EXCLUDED.kind, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
              address = EXCLUDED.address, website = EXCLUDED.website, opening_hours = EXCLUDED.opening_hours,
              wheelchair = EXCLUDED.wheelchair, fee = EXCLUDED.fee, wikidata_id = EXCLUDED.wikidata_id, wikipedia = EXCLUDED.wikipedia,
              image_url = EXCLUDED.image_url, image_credit = EXCLUDED.image_credit, image_license = EXCLUDED.image_license,
              description = EXCLUDED.description, source = EXCLUDED.source, source_url = EXCLUDED.source_url,
              fetched_at = EXCLUDED.fetched_at, updated_at = now()`,
        [id, p.cityId, p.osmType, String(p.osmId), clean(p.name, 200), p.kind, Number(p.lat), Number(p.lon),
            p.address ? clean(p.address, 250) : null, p.website || null, p.openingHours ? clean(p.openingHours, 200) : null,
            p.wheelchair || null, p.fee || null, p.wikidataId || null, p.wikipedia || null, p.imageUrl || null,
            p.imageCredit ? clean(p.imageCredit, 250) : null, p.imageLicense ? clean(p.imageLicense, 120) : null,
            p.description ? clean(p.description, 800) : null, p.source || 'openstreetmap', p.sourceUrl,
            new Date(p.fetchedAt || s.now()).toISOString()]);
        return id;
    }

    async function replaceRoutesForCity(cityId, routeList) {
        const keep = [];
        for (const r of routeList) {
            const id = r.id || stableId('rte', r.key);
            keep.push(id);
            await db.exec(`INSERT INTO tours_routes
                (id, city_id, slug, title, summary, source, source_url, fetched_at, distance_m, duration_min, stop_count, generated, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
                ON CONFLICT (id) DO UPDATE SET
                  city_id = EXCLUDED.city_id, slug = EXCLUDED.slug, title = EXCLUDED.title, summary = EXCLUDED.summary,
                  source = EXCLUDED.source, source_url = EXCLUDED.source_url, fetched_at = EXCLUDED.fetched_at,
                  distance_m = EXCLUDED.distance_m, duration_min = EXCLUDED.duration_min, stop_count = EXCLUDED.stop_count,
                  generated = EXCLUDED.generated, updated_at = now()`,
            [id, cityId, r.slug, clean(r.title, 160), r.summary ? clean(r.summary, 800) : null, 'wikivoyage', r.sourceUrl,
                new Date(r.fetchedAt || s.now()).toISOString(), int(r.distanceM), int(r.durationMin), r.stops.length, true]);
            await db.exec('DELETE FROM tours_route_stops WHERE route_id = $1', [id]);
            for (const [i, stop] of r.stops.entries()) {
                await db.exec(`INSERT INTO tours_route_stops
                    (route_id, position, place_id, title, note, lat, lon, source, source_url, audio_status, audio_url)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,'wikivoyage',$8,'none',NULL)`,
                [id, i + 1, stop.placeId || null, clean(stop.title, 200), stop.note ? clean(stop.note, 600) : null,
                    Number(stop.lat), Number(stop.lon), r.sourceUrl]);
            }
        }
        if (keep.length) await db.exec('DELETE FROM tours_routes WHERE city_id = $1 AND NOT (id = ANY($2::text[]))', [cityId, keep]);
        else await db.exec('DELETE FROM tours_routes WHERE city_id = $1', [cityId]);
        return keep.length;
    }

    async function upsertLive(item) {
        const id = stableId('liv', `${item.kind}:${item.externalId}`);
        await db.exec(`INSERT INTO tours_live
            (id, kind, external_id, username, display_name, title, category, thumbnail_url, viewer_count, city_id, city_name,
             url, started_at, ended_at, fetched_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            ON CONFLICT (kind, external_id) DO UPDATE SET
              username = EXCLUDED.username, display_name = EXCLUDED.display_name, title = EXCLUDED.title,
              category = EXCLUDED.category, thumbnail_url = EXCLUDED.thumbnail_url, viewer_count = EXCLUDED.viewer_count,
              city_id = EXCLUDED.city_id, city_name = EXCLUDED.city_name, url = EXCLUDED.url,
              started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, fetched_at = EXCLUDED.fetched_at`,
        [id, item.kind, String(item.externalId), item.username, item.displayName ? clean(item.displayName, 80) : null,
            clean(item.title, 240), item.category ? clean(item.category, 40) : null, item.thumbnailUrl || null,
            Math.max(0, int(item.viewerCount)), item.cityId || null, item.cityName ? clean(item.cityName, 120) : null,
            item.url, item.startedAt ? new Date(item.startedAt).toISOString() : null,
            item.endedAt ? new Date(item.endedAt).toISOString() : null, new Date(item.fetchedAt || s.now()).toISOString()]);
        return id;
    }

    async function clearLiveStreams() {
        await db.exec("DELETE FROM tours_live WHERE kind = 'stream'");
    }
    async function trimLiveVods(keep = 200) {
        await db.exec(`DELETE FROM tours_live WHERE kind = 'vod' AND id NOT IN
            (SELECT id FROM tours_live WHERE kind IN ('vod', 'clip') ORDER BY COALESCE(ended_at, fetched_at) DESC LIMIT $1)`, [keep]);
    }

    async function upsertStay(st) {
        const id = stableId('sty', st.externalId);
        await db.exec(`INSERT INTO tours_stays
            (id, external_id, city_id, city_name, title, kind, price, currency, period, neighbourhood, url, fetched_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (external_id) DO UPDATE SET
              city_id = EXCLUDED.city_id, city_name = EXCLUDED.city_name, title = EXCLUDED.title, kind = EXCLUDED.kind,
              price = EXCLUDED.price, currency = EXCLUDED.currency, period = EXCLUDED.period,
              neighbourhood = EXCLUDED.neighbourhood, url = EXCLUDED.url, fetched_at = EXCLUDED.fetched_at`,
        [id, st.externalId, st.cityId || null, clean(st.cityName, 120), clean(st.title, 200), st.kind,
            Number(st.price), st.currency, st.period, st.neighbourhood ? clean(st.neighbourhood, 120) : null,
            st.url, new Date(st.fetchedAt || s.now()).toISOString()]);
        return id;
    }

    // ── Trips ───────────────────────────────────────────────
    function tripFields(input, base = null) {
        const v = { ...base };
        if (input.title !== undefined) v.title = clean(input.title, 120);
        if (input.city_slug !== undefined) v.city_slug = clean(input.city_slug, 90);
        if (input.starts_on !== undefined) v.starts_on = String(input.starts_on || '');
        if (input.ends_on !== undefined) v.ends_on = String(input.ends_on || '');
        if (input.notes !== undefined) v.notes = clean(input.notes, 2000);
        if (input.visibility !== undefined) v.visibility = String(input.visibility || '');
        return v;
    }

    async function validateTrip(v, { partial = false } = {}) {
        if (!partial || v.title !== undefined) {
            if (String(v.title || '').length < 3 || String(v.title || '').length > 120) return refusal(400, 'tours.trip.invalid', 'title must be 3 to 120 characters');
        }
        if (!partial || v.starts_on !== undefined) {
            if (!isIsoDay(v.starts_on)) return refusal(400, 'tours.trip.invalid', 'starts_on must be a date (YYYY-MM-DD)');
        }
        if (!partial || v.ends_on !== undefined) {
            if (!isIsoDay(v.ends_on)) return refusal(400, 'tours.trip.invalid', 'ends_on must be a date (YYYY-MM-DD)');
        }
        if (isIsoDay(v.starts_on) && isIsoDay(v.ends_on)) {
            const days = (Date.parse(`${v.ends_on}T00:00:00Z`) - Date.parse(`${v.starts_on}T00:00:00Z`)) / 86_400_000;
            if (days < 0) return refusal(400, 'tours.trip.invalid', 'ends_on must not be before starts_on');
            if (days > 60) return refusal(400, 'tours.trip.invalid', 'a trip may be at most 60 days');
        }
        if (v.notes != null && String(v.notes).length > 2000) return refusal(400, 'tours.trip.invalid', 'notes are at most 2000 characters');
        if (v.visibility !== undefined && v.visibility !== null && !VISIBILITIES.includes(v.visibility)) return refusal(400, 'tours.trip.invalid', 'visibility must be private or shared');
        return { ok: true };
    }

    async function createTrip({ subject, title, citySlug, startsOn, endsOn, notes = '', visibility = 'private' }) {
        if (!SUBJECT_RE.test(String(subject || ''))) return refusal(403, 'tours.person_required', 'a person is required');
        const v = tripFields({ title, city_slug: citySlug, starts_on: startsOn, ends_on: endsOn, notes, visibility });
        if (!v.visibility) v.visibility = 'private';
        const check = await validateTrip(v);
        if (!check.ok) return check;
        const city = await cityBySlug(v.city_slug);
        if (!city) return refusal(400, 'tours.trip.invalid', 'city_slug must name a city Tours knows');
        const id = `trp_${ids.ulid(s.now())}`;
        const slug = `trip-${crypto.randomBytes(12).toString('hex')}`;
        const row = await db.maybe(`INSERT INTO tours_trips (id, slug, owner_subject, title, city_id, starts_on, ends_on, notes, visibility)
            VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9) RETURNING *`,
        [id, slug, subject, v.title, city.id, v.starts_on, v.ends_on, v.notes || null, v.visibility]);
        return { ok: true, trip: wireTrip(row), city };
    }

    async function tripsForSubject(subject) {
        const rows = await db.many(`SELECT t.*, c.slug AS city_slug, c.name AS city_name
            FROM tours_trips t LEFT JOIN tours_cities c ON c.id = t.city_id
            WHERE t.owner_subject = $1 ORDER BY t.starts_on DESC LIMIT 100`, [String(subject || '')]);
        return rows.map((r) => ({ ...wireTrip(r), city_slug: r.city_slug || null, city_name: r.city_name || null }));
    }

    async function tripBySlug(slug, { subject = null } = {}) {
        const row = await db.maybe(`SELECT t.*, c.slug AS city_slug, c.name AS city_name, c.lat AS city_lat, c.lon AS city_lon
            FROM tours_trips t LEFT JOIN tours_cities c ON c.id = t.city_id WHERE t.slug = $1`, [String(slug || '')]);
        if (!row) return null;
        const mine = subject && row.owner_subject === subject;
        if (!mine && row.visibility !== 'shared') return null;
        const [places, route, staysRows] = await Promise.all([
            db.many(`SELECT p.*, c.slug AS city_slug, c.name AS city_name, tp.position, tp.note AS trip_note
                FROM tours_trip_places tp JOIN tours_places p ON p.id = tp.place_id JOIN tours_cities c ON c.id = p.city_id
                WHERE tp.trip_id = $1 ORDER BY tp.position`, [row.id]),
            db.maybe(`SELECT r.*, tr.added_at FROM tours_trip_routes tr JOIN tours_routes r ON r.id = tr.route_id WHERE tr.trip_id = $1`, [row.id]),
            db.many(`SELECT s.*, ts.added_at FROM tours_trip_stays ts JOIN tours_stays s ON s.id = ts.stay_id WHERE ts.trip_id = $1 ORDER BY ts.added_at`, [row.id]),
        ]);
        let routeOut = null;
        if (route) {
            const stops = await db.many('SELECT * FROM tours_route_stops WHERE route_id = $1 ORDER BY position', [route.id]);
            routeOut = wireRoute(route, { stops: stops.map(wireStop) });
        }
        return {
            trip: { ...wireTrip(row), city_slug: row.city_slug || null, city_name: row.city_name || null,
                city_lat: num(row.city_lat), city_lon: num(row.city_lon) },
            mine: Boolean(mine),
            places: places.map((p) => ({ ...wirePlace(p), position: Number(p.position), trip_note: p.trip_note || null })),
            route: routeOut,
            stays: staysRows.map(wireStay),
        };
    }

    async function updateTrip({ subject, slug, input }) {
        const row = await db.maybe('SELECT * FROM tours_trips WHERE slug = $1', [String(slug || '')]);
        if (!row) return refusal(404, 'tours.trip_not_found', 'no such trip');
        if (row.owner_subject !== subject) return refusal(403, 'tours.trip_owner', 'only the person who made this trip can change it');
        const base = {
            title: row.title, city_slug: null, starts_on: day(row.starts_on), ends_on: day(row.ends_on),
            notes: row.notes || '', visibility: row.visibility,
        };
        const merged = tripFields(input || {}, base);
        if (input && input.city_slug !== undefined) {
            const city = await cityBySlug(merged.city_slug);
            if (!city) return refusal(400, 'tours.trip.invalid', 'city_slug must name a city Tours knows');
            merged.city_id = city.id;
        } else merged.city_id = row.city_id;
        const check = await validateTrip(merged);
        if (!check.ok) return check;
        const updated = await db.maybe(`UPDATE tours_trips SET title=$2, city_id=$3, starts_on=$4::date, ends_on=$5::date,
            notes=$6, visibility=$7, revision=revision+1, updated_at=now() WHERE id=$1 RETURNING *`,
        [row.id, merged.title, merged.city_id, merged.starts_on, merged.ends_on, merged.notes || null, merged.visibility]);
        return { ok: true, trip: wireTrip(updated) };
    }

    async function deleteTrip({ subject, slug }) {
        const row = await db.maybe('SELECT * FROM tours_trips WHERE slug = $1', [String(slug || '')]);
        if (!row) return refusal(404, 'tours.trip_not_found', 'no such trip');
        if (row.owner_subject !== subject) return refusal(403, 'tours.trip_owner', 'only the person who made this trip can change it');
        await db.exec('DELETE FROM tours_trips WHERE id = $1', [row.id]);
        return { ok: true };
    }

    async function ownedTrip(subject, slug) {
        const row = await db.maybe('SELECT * FROM tours_trips WHERE slug = $1', [String(slug || '')]);
        if (!row) return { error: refusal(404, 'tours.trip_not_found', 'no such trip') };
        if (row.owner_subject !== subject) return { error: refusal(403, 'tours.trip_owner', 'only the person who made this trip can change it') };
        return { row };
    }

    async function addTripPlace({ subject, slug, placeId, note = null }) {
        const own = await ownedTrip(subject, slug);
        if (own.error) return own.error;
        const place = await placeById(placeId);
        if (!place) return refusal(404, 'tours.place_not_found', 'no such place');
        const next = await db.value('SELECT COALESCE(MAX(position), 0) + 1 FROM tours_trip_places WHERE trip_id = $1', [own.row.id]);
        await db.exec(`INSERT INTO tours_trip_places (trip_id, place_id, position, note) VALUES ($1,$2,$3,$4)
            ON CONFLICT (trip_id, place_id) DO UPDATE SET note = EXCLUDED.note`, [own.row.id, place.id, Number(next), note ? clean(note, 500) : null]);
        await db.exec('UPDATE tours_trips SET revision = revision + 1, updated_at = now() WHERE id = $1', [own.row.id]);
        return { ok: true, place };
    }

    async function removeTripPlace({ subject, slug, placeId }) {
        const own = await ownedTrip(subject, slug);
        if (own.error) return own.error;
        await db.exec('DELETE FROM tours_trip_places WHERE trip_id = $1 AND place_id = $2', [own.row.id, String(placeId || '')]);
        await db.exec('UPDATE tours_trips SET revision = revision + 1, updated_at = now() WHERE id = $1', [own.row.id]);
        return { ok: true };
    }

    async function setTripRoute({ subject, slug, routeId }) {
        const own = await ownedTrip(subject, slug);
        if (own.error) return own.error;
        if (!routeId) {
            await db.exec('DELETE FROM tours_trip_routes WHERE trip_id = $1', [own.row.id]);
        } else {
            const route = await routeById(routeId);
            if (!route) return refusal(404, 'tours.route_not_found', 'no such route');
            if (own.row.city_id && route.city_id !== own.row.city_id) return refusal(400, 'tours.trip.invalid', 'the route must be in the trip\'s city');
            await db.exec(`INSERT INTO tours_trip_routes (trip_id, route_id) VALUES ($1,$2)
                ON CONFLICT (trip_id) DO UPDATE SET route_id = EXCLUDED.route_id, added_at = now()`, [own.row.id, route.id]);
        }
        await db.exec('UPDATE tours_trips SET revision = revision + 1, updated_at = now() WHERE id = $1', [own.row.id]);
        return { ok: true };
    }

    async function addTripStay({ subject, slug, stayId }) {
        const own = await ownedTrip(subject, slug);
        if (own.error) return own.error;
        const stay = await db.maybe('SELECT * FROM tours_stays WHERE id = $1', [String(stayId || '')]);
        if (!stay) return refusal(404, 'tours.stay_not_found', 'no such stay');
        if (own.row.city_id && stay.city_id && stay.city_id !== own.row.city_id) return refusal(400, 'tours.trip.invalid', 'the stay must be in the trip\'s city');
        await db.exec('INSERT INTO tours_trip_stays (trip_id, stay_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [own.row.id, stay.id]);
        await db.exec('UPDATE tours_trips SET revision = revision + 1, updated_at = now() WHERE id = $1', [own.row.id]);
        return { ok: true, stay: wireStay(stay) };
    }

    async function removeTripStay({ subject, slug, stayId }) {
        const own = await ownedTrip(subject, slug);
        if (own.error) return own.error;
        await db.exec('DELETE FROM tours_trip_stays WHERE trip_id = $1 AND stay_id = $2', [own.row.id, String(stayId || '')]);
        await db.exec('UPDATE tours_trips SET revision = revision + 1, updated_at = now() WHERE id = $1', [own.row.id]);
        return { ok: true };
    }

    return {
        counts, listCities, cityBySlug, cityPlaces, cityRoutes, cityLive, cityStays, citiesForOsm, markCityOsmFetched,
        placeById, routeById, routes, routesForPlace, placeOfTheDay, liveNow, recentTours, stays,
        latestJobRuns, recordJobStart, recordJobFinish,
        publicCitiesForSitemap, publicRoutesForSitemap, publicPlacesForSitemap, publicCitiesForLlms,
        upsertCity, upsertCitySource, citySourcesMissing, citySource, upsertPlace, replaceRoutesForCity,
        upsertLive, clearLiveStreams, trimLiveVods, upsertStay,
        createTrip, tripsForSubject, tripBySlug, updateTrip, deleteTrip,
        addTripPlace, removeTripPlace, setTripRoute, addTripStay, removeTripStay,
    };
}

module.exports = { createStore, stableId, slugify, wireCity, wirePlace, wireRoute, wireStop, wireLive, wireStay, wireTrip, SLUG_RE, SUBJECT_RE, VISIBILITIES, LIVE_KINDS };
