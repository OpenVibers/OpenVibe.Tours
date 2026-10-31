'use strict';
/** Run every source job against the fixtures, in order. Returns the last receipts. */
async function seed(t, { limit = 100 } = {}) {
    const out = {};
    for (const name of ['cities', 'places', 'routes', 'live', 'stays']) out[name] = await t.ctx.jobs.runOnce(name, { limit });
    return out;
}
module.exports = { seed };
