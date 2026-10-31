'use strict';
/**
 * Flights have no provider key in v1: the form and the API build the airline-neutral official search link with the
 * city pair filled in, with no affiliate parameter. A Duffel/Kiwi key alone does not turn an adapter on.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { validate, searchUrl, createFlights } = require('../server/flights');
const configLib = require('../server/config');

(async () => {
    const t = await boot();
    try {
        await check('validate accepts a city pair and dates, and refuses a missing city or a backward return', () => {
            assert.strictEqual(validate({ from: 'Lisbon', to: 'Tokyo', depart: '2026-11-10' }).ok, true);
            assert.strictEqual(validate({ from: 'Lisbon', to: 'Tokyo', depart: '2026-11-10', return: '2026-11-20' }).ok, true);
            assert.strictEqual(validate({ from: 'L', to: 'Tokyo', depart: '2026-11-10' }).ok, false);
            assert.strictEqual(validate({ from: 'Lisbon', to: 'Tokyo', depart: '2026-11-10', return: '2026-11-01' }).ok, false);
            assert.strictEqual(validate({ from: 'Lisbon', to: 'Tokyo', depart: 'tomorrow' }).ok, false);
        });

        await check('the search URL is the official neutral one with the pair and dates, and no affiliate', () => {
            const url = searchUrl({ from: 'Lisbon', to: 'Tokyo', depart: '2026-11-10', return: '2026-11-20' });
            assert.match(url, /^https:\/\/www\.google\.com\/travel\/flights\?/);
            const parsed = new URL(url);
            assert.match(parsed.searchParams.get('q'), /Flights from Lisbon to Tokyo/);
            assert.match(parsed.searchParams.get('q'), /2026-11-10/);
            for (const bad of ['tag=', 'partner=', 'ref=', 'utm_']) assert.ok(!url.toLowerCase().includes(bad), bad);
        });

        await check('a key alone leaves the provider seam off; the form shows the plain note', async () => {
            const withKey = createFlights({ config: configLib.load({ TOURS_DUFFEL_API_KEY: 'not-a-real-key' }) });
            const plan = withKey.plan({ from: 'Lisbon', to: 'Tokyo', depart: '2026-11-10' });
            assert.strictEqual(plan.enabled, false);
            assert.strictEqual(plan.providers.duffel, true);
            assert.match(plan.note, /no commission/);
            const page = await t.get('/flights?from=Lisbon&to=Tokyo&depart=2026-11-10');
            assert.strictEqual(page.status, 200);
            assert.match(page.text, /No flight API key yet/);
            assert.match(page.text, /official airline-neutral search/);
            assert.match(page.text, /target="_blank"/);
            assert.ok(!/tag=|utm_/i.test(page.text));
            const bad = await t.get('/flights?from=Lisbon&to=Tokyo&depart=soon');
            assert.strictEqual(bad.status, 200);
            assert.match(bad.text, /depart must be a date/);
        });
    } finally {
        await t.close();
    }
    done();
})();
