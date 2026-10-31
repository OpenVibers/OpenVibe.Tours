'use strict';

/**
 * Flights in v1 have no provider key. The form builds the airline-neutral official search link with the city pair
 * and the dates filled in; it never takes a commission and never claims a price it has not fetched. The Duffel and
 * Kiwi seams are reported off (a key alone does not turn an adapter on), so a later provider can replace
 * `searchUrl` without changing the page or the API.
 */
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const clean = (v, max = 80) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function validate({ from, to, depart, return: ret } = {}) {
    const a = clean(from); const b = clean(to);
    if (a.length < 2 || b.length < 2) return { ok: false, message: 'from and to must name a city' };
    if (!isDay(depart)) return { ok: false, message: 'depart must be a date (YYYY-MM-DD)' };
    if (ret && !isDay(ret)) return { ok: false, message: 'return must be a date (YYYY-MM-DD)' };
    if (ret && ret < depart) return { ok: false, message: 'return must not be before depart' };
    return { ok: true, value: { from: a, to: b, depart, return: ret || null } };
}

/** The official airline-neutral search, with the city pair and dates in the query. No affiliate parameter. */
function searchUrl({ from, to, depart, return: ret } = {}, config = {}) {
    const base = String((config.flights && config.flights.searchBase) || 'https://www.google.com/travel/flights');
    const text = ret
        ? `Flights from ${from} to ${to} on ${depart} through ${ret}`
        : `Flights from ${from} to ${to} on ${depart}`;
    return `${base}?${new URLSearchParams({ q: text, hl: 'en' })}`;
}

function createFlights({ config }) {
    const providers = {
        duffel: Boolean(config.flights.duffel.enabled),
        kiwi: Boolean(config.flights.kiwi.enabled),
        search: 'google-flights',
    };
    const enabled = false; // no adapter exists in v1; a key alone must not look like a live price feed

    function plan(input) {
        const check = validate(input);
        if (!check.ok) return check;
        return {
            ok: true,
            ...check.value,
            enabled,
            provider: 'google-flights',
            providers,
            url: searchUrl(check.value, config),
            note: 'Opens the official airline-neutral flight search in a new tab. Tours takes no commission and shows no price it has not fetched.',
        };
    }

    return { plan, validate, searchUrl, providers, enabled };
}

module.exports = { createFlights, validate, searchUrl };
