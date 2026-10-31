#!/usr/bin/env node
'use strict';

/**
 * First run / manual refresh of the source jobs, outside the server:
 *
 *   node scripts/seed.js                 # all five jobs, the configured city limit
 *   node scripts/seed.js cities places   # only these, in this order
 *   TOURS_CITY_LIMIT=20 node scripts/seed.js
 *
 * Development without DATABASE_URL uses the embedded PGlite database in data/pglite. The script never starts the
 * HTTP server, never starts the job timers and never writes a secret to the database.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.TOURS_DRILL = '1';
require('dotenv').config();

const configLib = require('../server/config');
const { openStore, createStore } = require('../server/db');
const { createStore: dataStore } = require('../server/store');
const { createJobs } = require('../server/jobs');

const NAMES = ['cities', 'places', 'routes', 'live', 'stays'];

(async () => {
    const config = configLib.load(process.env);
    const s = await openStore(config);
    const store = dataStore(s, { config });
    const jobs = createJobs({ config, s, store, fetchImpl: globalThis.fetch, log: console });
    const wanted = process.argv.slice(2).filter((x) => NAMES.includes(x));
    const names = wanted.length ? wanted : NAMES;
    console.log(`[seed] ${names.join(', ')} · city limit ${config.openData.cityLimit} · db ${config.db.url ? 'PostgreSQL' : 'PGlite'}`);
    try {
        for (const name of names) {
            const out = await jobs.runOnce(name);
            console.log(`[seed] ${name}: ${JSON.stringify(out)}`);
        }
        console.log('[seed] counts:', JSON.stringify(await store.counts()));
        const runs = await store.latestJobRuns();
        for (const r of runs) console.log(`[seed] receipt ${r.job}: ${r.status} ${JSON.stringify(r.counts)}${r.error ? ` — ${String(r.error).slice(0, 300)}` : ''}`);
    } finally {
        await s.close();
    }
})().catch((err) => { console.error('[seed] failed:', err && err.stack || err); process.exit(1); });
