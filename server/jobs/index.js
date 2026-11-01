'use strict';

/**
 * The source jobs. Each one fills one part of the database from one official/open source, records a run receipt in
 * tours_job_runs (status, counts, error) and is off under TOURS_DRILL, where tests call runOnce() directly. The
 * first production run fills the site; later runs refresh on their own interval.
 */
const { createPacer } = require('../sources/http');
const { createCitiesJob } = require('./cities');
const { createPlacesJob } = require('./places');
const { createRoutesJob } = require('./routes');
const { createLiveJob } = require('./live');
const { createStaysJob } = require('./stays');

function createJobs({ config, s, store, fetchImpl = globalThis.fetch, log = console }) {
    const pace = createPacer(config.openData.minIntervalMs);
    s.pace = pace;
    const ctx = { config, s, store, fetchImpl, log };
    const creators = {
        cities: createCitiesJob(ctx),
        places: createPlacesJob(ctx),
        routes: createRoutesJob(ctx),
        live: createLiveJob(ctx),
        stays: createStaysJob(ctx),
    };

    const jobs = {
        cities: { run: creators.cities.runOnce, maxAgeMs: config.jobs.citiesEveryMs, intervalMs: config.jobs.citiesEveryMs },
        places: { run: creators.places.runOnce, maxAgeMs: config.jobs.placesEveryMs, intervalMs: config.jobs.placesEveryMs },
        routes: { run: creators.routes.runOnce, maxAgeMs: config.jobs.routesEveryMs, intervalMs: config.jobs.routesEveryMs, version: creators.routes.version },
        live: { run: creators.live.runOnce, maxAgeMs: config.jobs.liveEveryMs, intervalMs: config.jobs.liveEveryMs },
        stays: { run: creators.stays.runOnce, maxAgeMs: config.jobs.staysEveryMs, intervalMs: config.jobs.staysEveryMs },
    };

    const running = new Set();
    const timers = [];
    // A run produced something when any of its numbers is above zero (the error list and the catalogue aside).
    const producedOf = (counts) => Object.entries(counts || {}).some(([k, v]) => k !== 'errors' && k !== 'catalog' && typeof v === 'number' && v > 0);
    // The jobs that work through the cities: when the cities job adds some, they run at once instead of waiting a week
    // (2026-11-01: places, routes and stays ran 11 minutes before the first cities landed, found none, and counted as
    // fresh for seven days).
    const AFTER_CITIES = ['places', 'routes', 'stays'];
    let scheduled = false;   // start() ran: only the scheduler follows the cities job (a test's runOnce does not)

    async function isFresh(name) {
        const rows = await store.latestJobRuns();
        const row = rows.find((r) => r.job === name);
        if (!row || !['ok', 'partial'].includes(row.status) || !row.finished_at) return false;
        // A run that found nothing to work on is not fresh: the next boot or the cities job runs it again.
        let counts = row.counts;
        if (typeof counts === 'string') { try { counts = JSON.parse(counts); } catch { counts = null; } }
        if (!producedOf(counts)) return false;
        // A run made under older rules (a job that names a version) is not fresh: the new rules apply at the next boot.
        if (jobs[name].version && (!counts || counts.version !== jobs[name].version)) return false;
        return Date.now() - new Date(row.finished_at).getTime() < jobs[name].maxAgeMs;
    }

    async function runOnce(name, opts = {}) {
        const job = jobs[name];
        if (!job) throw new Error(`unknown job: ${name}`);
        if (running.has(name)) return { skipped: 'already running' };
        running.add(name);
        const id = await store.recordJobStart(name);
        const started = Date.now();
        try {
            const counts = await job.run(opts);
            const errors = Array.isArray(counts && counts.errors) ? counts.errors : [];
            const produced = producedOf(counts);
            const status = errors.length ? (produced ? 'partial' : 'failed') : 'ok';
            await store.recordJobFinish(id, { status, counts, error: errors.length ? errors.slice(0, 10).join('; ') : null });
            log.log(`[Tours ${name}] ${status} in ${Math.round((Date.now() - started) / 1000)}s ${JSON.stringify(counts)}`);
            if (name === 'cities' && produced && scheduled && !opts.noFollow) followCities();
            return { status, counts };
        } catch (err) {
            await store.recordJobFinish(id, { status: 'failed', counts: {}, error: (err && err.message) || String(err) });
            log.warn(`[Tours ${name}] failed: ${err && err.message}`);
            return { status: 'failed', error: (err && err.message) || String(err) };
        } finally {
            running.delete(name);
        }
    }

    /** After cities land: each job that works through them runs now, unless it already has fresh work. Never awaited. */
    function followCities() {
        if (config.drill) return;
        const kick = setTimeout(async () => {
            for (const dep of AFTER_CITIES) {
                try { if (!await isFresh(dep)) await runOnce(dep); } catch (err) { log.warn(`[Tours ${dep}] ${err && err.message}`); }
            }
        }, 1000);
        kick.unref();
        timers.push(kick);
    }

    async function runAll() {
        const out = {};
        for (const name of ['cities', 'places', 'routes', 'live', 'stays']) out[name] = await runOnce(name, { noFollow: true });
        return out;
    }

    function start() {
        if (config.drill || !config.jobs.enabled) return;
        scheduled = true;
        const names = Object.keys(jobs);
        names.forEach((name, i) => {
            const kick = setTimeout(async () => {
                try { if (!await isFresh(name)) await runOnce(name); } catch (err) { log.warn(`[Tours ${name}] ${err && err.message}`); }
            }, 4000 + i * 750);
            kick.unref();
            const timer = setInterval(() => { runOnce(name).catch(() => {}); }, jobs[name].intervalMs);
            timer.unref();
            timers.push(timer, kick);
        });
    }

    function stop() {
        for (const t of timers) clearInterval(t);
        timers.length = 0;
    }

    return { runOnce, runAll, start, stop, isFresh, jobs };
}

module.exports = { createJobs };
