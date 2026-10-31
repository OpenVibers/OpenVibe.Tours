'use strict';

/**
 * The stays job: OpenVibe.Rent's public listings for a city. Rent is read-only here; a stay is a link to the
 * listing on openvibe.rent and never a payment. When Rent has no listing at all the job records an honest zero
 * instead of calling once per city.
 */
const { createRent } = require('../sources/rent');
const { fetchJson } = require('../sources/http');

function createStaysJob({ config, s, store, fetchImpl, log = console }) {
    const rent = createRent({ config, fetchImpl, pace: s.pace });

    async function anyListing() {
        const { json } = await fetchJson(`${config.upstreams.rent}/api/v1/listings?limit=1`, {
            fetchImpl, pace: s.pace, timeoutMs: config.upstreams.timeoutMs, userAgent: config.openData.userAgent, label: 'OpenVibe.Rent',
        });
        return Boolean(json && Array.isArray(json.listings) && json.listings.length > 0);
    }

    async function runOnce({ limit = config.openData.cityLimit } = {}) {
        const result = { cities: 0, stays: 0, empty: true, errors: [] };
        try {
            if (!await anyListing()) return result;
        } catch (err) {
            result.errors.push(err && err.message);
            return result;
        }
        result.empty = false;
        const cities = await store.listCities({ limit });
        for (const city of cities) {
            try {
                const { stays } = await rent.listings(city.name, { cityId: city.id, limit: 8 });
                for (const stay of stays) await store.upsertStay(stay);
                result.stays += stays.length;
                if (stays.length) result.cities += 1;
            } catch (err) {
                result.errors.push(`${city.slug}: ${err && err.message}`);
            }
        }
        return result;
    }

    return { runOnce };
}

module.exports = { createStaysJob };
