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
        routes: { run: creators.routes.runOnce, maxAgeMs: config.jobs.routesEveryMs, intervalMs: config.jobs.routesEveryMs },
        live: { run: creators.live.runOnce, maxAgeMs: config.jobs.liveEveryMs, intervalMs: config.jobs.liveEveryMs },
        stays: { run: creators.stays.runOnce, maxAgeMs: config.jobs.staysEveryMs, intervalMs: config.jobs.staysEveryMs },
    };

    const running = new Set();
    const timers = [];

    async function isFresh(name) {
        const rows = await store.latestJobRuns();
        const row = rows.find((r) => r.job === name);
        if (!row || !['ok', 'partial'].includes(row.status) || !row.finished_at) return false;
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
            const produced = Object.entries(counts || {}).some(([k, v]) => k !== 'errors' && k !== 'catalog' && typeof v === 'number' && v > 0);
            const status = errors.length ? (produced ? 'partial' : 'failed') : 'ok';
            await store.recordJobFinish(id, { status, counts, error: errors.length ? errors.slice(0, 10).join('; ') : null });
            log.log(`[Tours ${name}] ${status} in ${Math.round((Date.now() - started) / 1000)}s ${JSON.stringify(counts)}`);
            return { status, counts };
        } catch (err) {
            await store.recordJobFinish(id, { status: 'failed', counts: {}, error: (err && err.message) || String(err) });
            log.warn(`[Tours ${name}] failed: ${err && err.message}`);
            return { status: 'failed', error: (err && err.message) || String(err) };
        } finally {
            running.delete(name);
        }
    }

    async function runAll() {
        const out = {};
        for (const name of ['cities', 'places', 'routes', 'live', 'stays']) out[name] = await runOnce(name);
        return out;
    }

    function start() {
        if (config.drill || !config.jobs.enabled) return;
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
