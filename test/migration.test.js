'use strict';
/**
 * The migration applies in one pass and its constraints are real: a stable city/place/route id, a valid trip window,
 * a shared trip slug, a route stop that cannot claim ready audio without a URL, and one listing per Rent id.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { stableId } = require('../server/store');

(async () => {
    const t = await boot();
    try {
        await check('0001_initial.sql creates the Tours tables and the SDK tables', async () => {
            const names = (await t.ctx.s.db.many("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name")).map((r) => r.name);
            for (const table of ['tours_cities', 'tours_city_sources', 'tours_places', 'tours_routes', 'tours_route_stops',
                'tours_live', 'tours_stays', 'tours_trips', 'tours_trip_places', 'tours_trip_routes', 'tours_trip_stays',
                'tours_job_runs', 'account_data_events', 'telemetry_samples']) {
                assert.ok(names.includes(table), `missing ${table}`);
            }
        });

        await check('a trip cannot end before it starts, take more than 60 days, or use a bad id/slug/owner', async () => {
            const db = t.ctx.s.db;
            const id = `trp_${require('openvibe-contracts').ids.ulid()}`;
            const owner = require('openvibe-contracts').ids.newId('user');
            const base = `INSERT INTO tours_trips (id, slug, owner_subject, title, starts_on, ends_on, visibility) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7)`;
            await db.exec(base, [id, 'trip-0123456789abcdef01234567', owner, 'A trip', '2026-11-10', '2026-11-14', 'private']);
            await assert.rejects(db.exec(base, [`trp_${require('openvibe-contracts').ids.ulid()}`, 'trip-0123456789abcdef01234568', owner, 'Bad', '2026-11-14', '2026-11-10', 'private']), /tours_trips_dates/);
            await assert.rejects(db.exec(base, [`trp_${require('openvibe-contracts').ids.ulid()}`, 'trip-0123456789abcdef01234569', owner, 'Long', '2026-01-01', '2026-04-01', 'private']), /tours_trips_dates/);
            await assert.rejects(db.exec(base, ['bad_id', 'trip-0123456789abcdef01234570', owner, 'Bad id', '2026-11-10', '2026-11-14', 'private']), /tours_trips_id/);
            await assert.rejects(db.exec(base, [`trp_${require('openvibe-contracts').ids.ulid()}`, 'not-a-trip', owner, 'Bad slug', '2026-11-10', '2026-11-14', 'private']), /tours_trips_slug/);
            await assert.rejects(db.exec(base, [`trp_${require('openvibe-contracts').ids.ulid()}`, 'trip-0123456789abcdef01234571', 'kim', 'Bad owner', '2026-11-10', '2026-11-14', 'private']), /tours_trips_owner/);
            await assert.rejects(db.exec(base, [`trp_${require('openvibe-contracts').ids.ulid()}`, 'trip-0123456789abcdef01234572', owner, 'Bad visibility', '2026-11-10', '2026-11-14', 'secret']), /tours_trips_visibility/);
        });

        await check('a route stop cannot claim ready audio without an https URL', async () => {
            const db = t.ctx.s.db;
            const cityId = stableId('cty', 'Q597');
            await db.exec(`INSERT INTO tours_cities (id, slug, name, country, lat, lon, wikidata_id, source_url, fetched_at)
                VALUES ($1, 'lisbon', 'Lisbon', 'Portugal', 38.72, -9.13, 'Q597', 'https://www.wikidata.org/wiki/Q597', now())
                ON CONFLICT (id) DO NOTHING`, [cityId]);
            const routeId = stableId('rte', 'Q597:see:0');
            await db.exec(`INSERT INTO tours_routes (id, city_id, slug, title, source_url, fetched_at, stop_count)
                VALUES ($1,$2,'lisbon-see-1','Lisbon walk','https://en.wikivoyage.org/wiki/Lisbon', now(), 1)`, [routeId, cityId]);
            await assert.rejects(db.exec(`INSERT INTO tours_route_stops (route_id, position, title, lat, lon, source_url, audio_status, audio_url)
                VALUES ($1, 1, 'A stop', 38.7, -9.1, 'https://en.wikivoyage.org/wiki/Lisbon', 'ready', NULL)`, [routeId]), /tours_route_stops_audio_url/);
            await db.exec(`INSERT INTO tours_route_stops (route_id, position, title, lat, lon, source_url) VALUES ($1, 1, 'A stop', 38.7, -9.1, 'https://en.wikivoyage.org/wiki/Lisbon')`, [routeId]);
            assert.strictEqual((await db.maybe('SELECT audio_status FROM tours_route_stops WHERE route_id = $1', [routeId])).audio_status, 'none');
        });
    } finally {
        await t.close();
    }
    done();
})();
