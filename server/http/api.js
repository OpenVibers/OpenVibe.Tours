'use strict';

/**
 * /api/v1 — OpenVibe.Tours' JSON API.
 *
 *   GET    /cities?limit=&offset=&q=          the catalogue
 *   GET    /cities/:slug                      one city, its places, routes, live and stays
 *   GET    /places/:id                        one place and the routes it is on
 *   GET    /routes/:id                        one route with its ordered stops
 *   GET    /live                              IRL tours now and recent VODs
 *   GET    /openapi.json                      the OpenAPI 3.1 document
 *   GET    /trips                             the signed-in person's trips
 *   POST   /trips                             create one
 *   GET    /trips/:slug                       own, or shared read-only
 *   PATCH  /trips/:slug                       edit own
 *   DELETE /trips/:slug                       delete own
 *   POST   /trips/:slug/places                save a place
 *   DELETE /trips/:slug/places/:placeId       remove it
 *   POST   /trips/:slug/route                 set or clear the route
 *   POST   /trips/:slug/stays                 add a stay
 *   DELETE /trips/:slug/stays/:stayId         remove it
 *
 * Errors are application/problem+json with a stable code. A person is the tours_at session cookie or a Network
 * user token as a Bearer; a session write must come from openvibe.tours itself (403 tours.cross_site). No route
 * needs a service token.
 */
const express = require('express');
const { http } = require('openvibe-contracts');
const { asyncRouter } = require('./router');
const { sameOrigin } = require('./principal');
const { document: openapi } = require('../openapi');

function createApi(ctx) {
    const { config, s, principal, store } = ctx;
    const r = asyncRouter();

    r.use(express.json({ limit: '64kb' }));
    r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    r.use(principal.middleware);

    const buckets = new Map();
    function windowCount(key, windowMs, limit) {
        const now = Date.now();
        let b = buckets.get(key);
        if (!b || now - b.start >= windowMs) { b = { start: now, n: 0 }; buckets.set(key, b); }
        b.n += 1;
        return b.n <= limit;
    }
    r.use((req, res, next) => {
        if (req.principal && req.principal.kind === 'user' && req.principal.subject) {
            const who = `user:${req.principal.subject}`;
            if (!windowCount(`${who}:m`, 60_000, config.limits.minute) || !windowCount(`${who}:h`, 60 * 60_000, config.limits.hour)) {
                return problem(res, 429, 'tours.rate_limited', 'too many requests from this account; retry shortly');
            }
            if (buckets.size > 20_000) for (const [k, b] of buckets) if (Date.now() - b.start > 2 * 60 * 60_000) buckets.delete(k);
        }
        return next();
    });

    const problem = (res, status, code, detail) => http.sendProblem(res, status, code, { detail, ctx: res.req && res.req.ov });
    const invalid = (res, detail, field = null) => problem(res, 400, 'tours.invalid', field ? `${field}: ${detail}` : detail);
    const refuse = (res, out) => problem(res, out.status || 400, out.code || 'tours.invalid', out.message || 'invalid request');
    const asInt = (v, def) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);

    function person(req, res) {
        const p = req.principal;
        if (p.kind === 'anonymous') { problem(res, 401, 'tours.sign_in_required', 'Sign in at openvibe.tours, or send a person\'s Network token as a Bearer.'); return null; }
        if (p.kind !== 'user') { problem(res, 403, 'tours.person_required', 'This route is for a person, not an app or service.'); return null; }
        if (p.viaSession && req.method !== 'GET' && !sameOrigin(req, config.baseUrl)) {
            problem(res, 403, 'tours.cross_site', 'A signed-in request that changes something must come from openvibe.tours itself.');
            return null;
        }
        return p;
    }

    const okPublic = (res, maxAge = 60) => res.set('Cache-Control', `public, max-age=${maxAge}`);

    r.get('/ping', (_req, res) => res.json({ ok: true, service: config.service }));

    // ── Public open data ─────────────────────────────────────
    r.get('/cities', async (req, res) => {
        const limit = req.query.limit == null || req.query.limit === '' ? 100 : asInt(req.query.limit, 100);
        const offset = req.query.offset == null || req.query.offset === '' ? 0 : asInt(req.query.offset, 0);
        if (!Number.isFinite(limit) || limit < 1 || limit > 200) return invalid(res, 'limit must be from 1 to 200', 'limit');
        if (!Number.isFinite(offset) || offset < 0) return invalid(res, 'offset must be 0 or more', 'offset');
        const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : null;
        const cities = await store.listCities({ limit, offset, q });
        okPublic(res);
        return res.json({ count: cities.length, cities });
    });

    r.get('/cities/:slug', async (req, res) => {
        const city = await store.cityBySlug(String(req.params.slug || ''));
        if (!city) return problem(res, 404, 'tours.city_not_found', 'No such city.');
        const [places, routes, live, stays] = await Promise.all([
            store.cityPlaces(city.id, { limit: 100 }), store.cityRoutes(city.id), store.cityLive(city.id), store.cityStays(city.id),
        ]);
        okPublic(res);
        return res.json({ city, places, routes, live, stays });
    });

    r.get('/places/:id', async (req, res) => {
        const place = await store.placeById(String(req.params.id || ''));
        if (!place) return problem(res, 404, 'tours.place_not_found', 'No such place.');
        const routes = await store.routesForPlace(place.id);
        okPublic(res);
        return res.json({ place, routes });
    });

    r.get('/routes/:id', async (req, res) => {
        const route = await store.routeById(String(req.params.id || ''));
        if (!route) return problem(res, 404, 'tours.route_not_found', 'No such route.');
        okPublic(res);
        return res.json({ route });
    });

    r.get('/live', async (_req, res) => {
        const [live, recent] = await Promise.all([store.liveNow({ limit: 50 }), store.recentTours({ limit: 25 })]);
        okPublic(res, 30);
        return res.json({
            live, recent, source: 'OpenVibe.Live public stream list',
            fetched_at: (live[0] || recent[0] || {}).fetched_at || null,
        });
    });

    r.get('/openapi.json', (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300');
        return res.json(openapi);
    });

    // ── Trips ───────────────────────────────────────────────
    r.get('/trips', async (req, res) => {
        const p = person(req, res); if (!p) return undefined;
        const trips = await store.tripsForSubject(p.subject);
        return res.json({ count: trips.length, trips });
    });

    r.post('/trips', async (req, res) => {
        const p = person(req, res); if (!p) return undefined;
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const out = await store.createTrip({
            subject: p.subject, title: b.title, citySlug: b.city_slug || b.city,
            startsOn: b.starts_on, endsOn: b.ends_on, notes: b.notes, visibility: b.visibility,
        });
        if (!out.ok) return refuse(res, out);
        res.set('Location', `/api/v1/trips/${out.trip.slug}`);
        return res.status(201).json(out.trip);
    });

    r.get('/trips/:slug', async (req, res) => {
        const subject = req.principal.kind === 'user' ? req.principal.subject : null;
        const out = await store.tripBySlug(String(req.params.slug || ''), { subject });
        if (!out) return problem(res, 404, 'tours.trip_not_found', 'No such trip, or it is private.');
        res.set('Cache-Control', out.mine ? 'private, no-store' : 'public, max-age=60');
        return res.json({ trip: out.trip, mine: out.mine, places: out.places, route: out.route, stays: out.stays });
    });

    r.patch('/trips/:slug', async (req, res) => {
        const p = person(req, res); if (!p) return undefined;
        const out = await store.updateTrip({ subject: p.subject, slug: String(req.params.slug || ''), input: req.body && typeof req.body === 'object' ? req.body : {} });
        if (!out.ok) return refuse(res, out);
        return res.json(out.trip);
    });

    r.delete('/trips/:slug', async (req, res) => {
        const p = person(req, res); if (!p) return undefined;
        const out = await store.deleteTrip({ subject: p.subject, slug: String(req.params.slug || '') });
        if (!out.ok) return refuse(res, out);
        return res.status(204).end();
    });

    r.post('/trips/:slug/places', async (req, res) => {
        const p = person(req, res); if (!p) return undefined;
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        if (!b.place_id) return invalid(res, 'place_id is required', 'place_id');
        const out = await store.addTripPlace({ subject: p.subject, slug: String(req.params.slug || ''), placeId: b.place_id, note: b.note });
        if (!out.ok) return refuse(res, out);
        return res.status(201).json(out.place);
    });

    r.delete('/trips/:slug/places/:placeId', async (req, res) => {
        const p = person(req, res); if (!p) return undefined;
        const out = await store.removeTripPlace({ subject: p.subject, slug: String(req.params.slug || ''), placeId: String(req.params.placeId || '') });
        if (!out.ok) return refuse(res, out);
        return res.status(204).end();
    });

    r.post('/trips/:slug/route', async (req, res) => {
        const p = person(req, res); if (!p) return undefined;
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const out = await store.setTripRoute({ subject: p.subject, slug: String(req.params.slug || ''), routeId: b.route_id || null });
        if (!out.ok) return refuse(res, out);
        return res.json({ ok: true });
    });

    r.post('/trips/:slug/stays', async (req, res) => {
        const p = person(req, res); if (!p) return undefined;
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        if (!b.stay_id) return invalid(res, 'stay_id is required', 'stay_id');
        const out = await store.addTripStay({ subject: p.subject, slug: String(req.params.slug || ''), stayId: b.stay_id });
        if (!out.ok) return refuse(res, out);
        return res.status(201).json(out.stay);
    });

    r.delete('/trips/:slug/stays/:stayId', async (req, res) => {
        const p = person(req, res); if (!p) return undefined;
        const out = await store.removeTripStay({ subject: p.subject, slug: String(req.params.slug || ''), stayId: String(req.params.stayId || '') });
        if (!out.ok) return refuse(res, out);
        return res.status(204).end();
    });

    return r;
}

module.exports = { createApi };
