'use strict';

/**
 * Tours' server-rendered pages. Everything works without JavaScript: the trip forms are plain POSTs and every place
 * has its OpenStreetMap link. Public pages are public, max-age=60; a page drawn for a signed-in person or a private
 * trip is private, no-store; a shared trip is readable by anyone with the link.
 */
const express = require('express');
const seo = require('openvibe-shared/seo');
const { asyncRouter } = require('./router');
const { createDiscoveryRoutes, homeJsonLd } = require('./discovery');
const { sameOrigin } = require('./principal');
const { raw } = require('../render/html');
const { send } = require('../render/layout');
const views = require('../views');
const { createFlights } = require('../flights');

const PUBLIC_CACHE = 'public, max-age=60';

function createPageRoutes(ctx) {
    const { config, store } = ctx;
    const r = asyncRouter();
    r.use(express.urlencoded({ extended: false, limit: '64kb' }));
    const base = () => String(config.baseUrl).replace(/\/+$/, '');
    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => req.viewer && req.viewer.kind === 'user' && req.viewer.subject;
    const flights = createFlights({ config });

    const notFromHere = (req, res) => page(req, res, {
        title: 'Not from this site',
        body: raw('<div class="tr-wrap tr-page-pad tr-narrow"><div class="tr-empty"><h1>That came from somewhere else</h1><p class="tr-muted">Use the form on <a href="/">OpenVibe.Tours</a>.</p></div></div>'),
    }, 403);
    const guard = (req, res, next) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent(req.originalUrl.split('?')[0])}`);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        return next();
    };
    const formValues = (body, fields) => Object.fromEntries(fields.map((f) => [f, body && body[f] != null ? String(body[f]) : '']));

    function tripJsonLd(trip, route) {
        return {
            '@context': 'https://schema.org', '@type': 'TouristTrip', name: trip.title,
            description: trip.notes || `${trip.title} in ${trip.city_name || trip.city_slug || ''}, ${trip.starts_on} to ${trip.ends_on}.`,
            url: `${base()}/trips/${trip.slug}`, touristType: 'Independent',
            ...(route ? { itinerary: { '@type': 'ItemList', numberOfItems: route.stops.length, itemListElement: route.stops.map((s, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'TouristAttraction', name: s.title, geo: { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.lon } } })) } } : {}),
        };
    }

    // ── Home ─────────────────────────────────────────────────
    r.get('/', async (req, res) => {
        const [counts, live, recent, placeOfDay, cities, routes, stays, jobs] = await Promise.all([
            store.counts(), store.liveNow({ limit: 8 }), store.recentTours({ limit: 8 }), store.placeOfTheDay(new Date().toISOString().slice(0, 10)),
            store.listCities({ limit: 8 }), store.routes({ limit: 8 }), store.stays({ limit: 8 }), store.latestJobRuns(),
        ]);
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, title: null,
            description: 'Go anywhere: fly, stay, walk, watch. Cities and places from OpenStreetMap, Wikivoyage and Wikidata, IRL tours on OpenVibe.Live, stays from OpenVibe.Rent, self-guided routes, and trips you can share read-only.',
            jsonLd: homeJsonLd(config),
            body: raw(views.home({ counts, live, recent, placeOfDay, cities, routes, stays, jobs })),
        });
    });

    // ── Cities ───────────────────────────────────────────────
    r.get('/cities', async (req, res) => {
        const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
        const cities = await store.listCities({ limit: 100, q: q || null });
        return page(req, res, {
            index: true, cache: q ? null : PUBLIC_CACHE, title: 'Cities',
            description: 'The top 100 cities from Wikidata and Wikivoyage, with places from OpenStreetMap, self-guided routes, live tours and stays.',
            jsonLd: [seo.jsonLd.webPage({ name: 'Cities on OpenVibe.Tours', url: `${base()}/cities`, description: 'The top 100 cities from open data.', siteUrl: base() })],
            body: raw(views.citiesPage({ cities, q })),
        });
    });

    r.get('/city/:slug', async (req, res) => {
        const city = await store.cityBySlug(String(req.params.slug || ''));
        if (!city) return page(req, res, { index: false, title: 'Not found', body: raw(views.notFound()) }, 404);
        const [places, routes, live, stays] = await Promise.all([
            store.cityPlaces(city.id, { limit: 60 }), store.cityRoutes(city.id), store.cityLive(city.id), store.cityStays(city.id),
        ]);
        const attractions = places.slice(0, 10).map((p) => ({
            '@type': 'TouristAttraction', name: p.name, url: `${base()}/place/${p.id}`,
            geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lon },
            ...(p.description ? { description: p.description } : {}), ...(p.image_url ? { image: p.image_url } : {}),
        }));
        const tripLd = routes.slice(0, 3).map((rt) => ({
            '@type': 'TouristTrip', name: rt.title, url: `${base()}/routes/${rt.id}`, description: rt.summary || undefined,
            itinerary: { '@type': 'ItemList', numberOfItems: rt.stop_count },
        }));
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, title: city.name,
            description: city.summary ? String(city.summary).slice(0, 180) : `${city.name}: places, self-guided routes, live tours and stays.`,
            jsonLd: [
                { '@context': 'https://schema.org', '@type': 'TouristDestination', name: city.name, url: `${base()}/city/${city.slug}`, description: city.summary || undefined, geo: { '@type': 'GeoCoordinates', latitude: city.lat, longitude: city.lon }, touristType: 'Independent', ...(city.image_url ? { image: city.image_url } : {}) },
                ...(attractions.length ? [{ '@context': 'https://schema.org', '@type': 'ItemList', name: `Places in ${city.name}`, numberOfItems: attractions.length, itemListElement: attractions.map((a, i) => ({ '@type': 'ListItem', position: i + 1, item: a })) }] : []),
                ...tripLd,
                seo.jsonLd.breadcrumbs([{ name: 'Cities', url: `${base()}/cities` }, { name: city.name, url: `${base()}/city/${city.slug}` }]),
            ],
            body: raw(views.cityPage({ city, places, routes, live, stays })),
        });
    });

    // ── Places ───────────────────────────────────────────────
    r.get('/place/:id', async (req, res) => {
        const place = await store.placeById(String(req.params.id || ''));
        if (!place) return page(req, res, { index: false, title: 'Not found', body: raw(views.notFound()) }, 404);
        const [routeList, trips] = await Promise.all([
            store.routesForPlace(place.id),
            signedIn(req) ? store.tripsForSubject(req.viewer.subject) : Promise.resolve([]),
        ]);
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, title: place.name,
            description: place.description || `${place.name} in ${place.city_name}: coordinates, address, opening hours, source and map.`,
            jsonLd: [
                {
                    '@context': 'https://schema.org', '@type': 'TouristAttraction', name: place.name,
                    url: `${base()}/place/${place.id}`, description: place.description || undefined,
                    geo: { '@type': 'GeoCoordinates', latitude: place.lat, longitude: place.lon },
                    ...(place.address ? { address: { '@type': 'PostalAddress', streetAddress: place.address, addressLocality: place.city_name } } : {}),
                    ...(place.image_url ? { image: place.image_url } : {}),
                    ...(place.fee === 'no' ? { isAccessibleForFree: true } : place.fee === 'yes' ? { isAccessibleForFree: false } : {}),
                    sameAs: [place.osm_url],
                },
                seo.jsonLd.breadcrumbs([{ name: 'Cities', url: `${base()}/cities` }, { name: place.city_name, url: `${base()}/city/${place.city_slug}` }, { name: place.name, url: `${base()}/place/${place.id}` }]),
            ],
            body: raw(views.placePage({ place, routeList, trips })),
        });
    });

    // ── Routes ───────────────────────────────────────────────
    r.get('/routes', async (req, res) => {
        const routes = await store.routes({ limit: 60 });
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, title: 'Self-guided routes',
            description: 'Self-guided walks generated from Wikivoyage See lists, with cited stops, coordinates and OpenStreetMap maps.',
            jsonLd: [seo.jsonLd.itemList('Self-guided routes on OpenVibe.Tours', routes.map((rt) => ({ name: rt.title, url: `${base()}/routes/${rt.id}`, description: rt.summary })), { url: `${base()}/routes` })],
            body: raw(`<div class="tr-wrap" id="tr-routes-page"><header class="tr-page-h"><p class="tr-kicker">Walk</p><h1>Self-guided routes</h1><p class="tr-lede">Ordered stops on a map, generated from Wikivoyage's See lists and marked as generated. Every stop cites the page it came from. Not a guided tour: check opening hours and access before you go.</p></header>
${routes.length ? `<ol class="tr-route-list tr-route-list-big">${routes.map((rt) => `<li><a href="/routes/${rt.id}"><strong>${rt.title}</strong><span class="tr-muted">${rt.city_name} · ${rt.stop_count} stops · ${(Number(rt.distance_m) / 1000).toFixed(1)} km · ${rt.duration_min} min</span><span class="tr-muted">${rt.summary || ''}</span></a></li>`).join('')}</ol>` : '<p class="tr-muted">No route has been generated yet. The routes job needs a Wikivoyage See list with at least four places that have coordinates.</p>'}
<p class="tr-fine">Wikivoyage CC BY-SA 4.0 · OpenStreetMap ODbL</p></div>`),
        });
    });

    r.get('/routes/:id', async (req, res) => {
        const route = await store.routeById(String(req.params.id || ''));
        if (!route) return page(req, res, { index: false, title: 'Not found', body: raw(views.notFound()) }, 404);
        const trips = signedIn(req) ? await store.tripsForSubject(req.viewer.subject) : [];
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, title: route.title,
            description: route.summary || `A self-guided route in ${route.city_name}, generated from Wikivoyage.`,
            head: `<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">\n<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js" defer></script>`,
            jsonLd: [{
                '@context': 'https://schema.org', '@type': 'TouristTrip', name: route.title, description: route.summary || undefined,
                url: `${base()}/routes/${route.id}`, touristType: 'Self-guided',
                itinerary: {
                    '@type': 'ItemList', numberOfItems: route.stops.length,
                    itemListElement: route.stops.map((s, i) => ({
                        '@type': 'ListItem', position: i + 1,
                        item: { '@type': 'TouristAttraction', name: s.title, description: s.note || undefined, geo: { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.lon }, sameAs: s.source_url },
                    })),
                },
            }],
            body: raw(views.routePage({ route, trips })),
        });
    });

    // ── Live and stays ──────────────────────────────────────
    r.get('/live', async (req, res) => {
        const [live, recent] = await Promise.all([store.liveNow({ limit: 50 }), store.recentTours({ limit: 25 })]);
        return page(req, res, {
            index: true, cache: 'public, max-age=30', title: 'Live tours now',
            description: 'IRL tours live on OpenVibe.Live now, and recent IRL recordings, with the city when the public title or tags name one.',
            jsonLd: [seo.jsonLd.webPage({ name: 'Live tours on OpenVibe.Tours', url: `${base()}/live`, description: 'IRL tours live on OpenVibe.Live.', siteUrl: base() })],
            body: raw(views.livePage({ live, recent })),
        });
    });

    r.get('/stays', async (req, res) => {
        const stays = await store.stays({ limit: 60 });
        const trips = signedIn(req) ? await store.tripsForSubject(req.viewer.subject) : [];
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, title: 'Stays',
            description: 'Active rentals from OpenVibe.Rent for the cities Tours covers. No payment and no booking fee on Tours.',
            jsonLd: [seo.jsonLd.webPage({ name: 'Stays on OpenVibe.Tours', url: `${base()}/stays`, description: 'Rentals from OpenVibe.Rent.', siteUrl: base() })],
            body: raw(views.staysPage({ stays, trips })),
        });
    });

    // ── Flights ──────────────────────────────────────────────
    r.get('/flights', (req, res) => {
        const values = {
            from: typeof req.query.from === 'string' ? req.query.from.slice(0, 80) : '',
            to: typeof req.query.to === 'string' ? req.query.to.slice(0, 80) : '',
            depart: typeof req.query.depart === 'string' ? req.query.depart.slice(0, 10) : '',
            return: typeof req.query.return === 'string' ? req.query.return.slice(0, 10) : '',
        };
        let result = null; let error = null;
        if (Object.values(values).some(Boolean)) {
            const out = flights.plan(values);
            if (!out.ok) error = out.message; else result = out;
        }
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, title: 'Flights',
            description: 'No flight API key yet: this form opens the official airline-neutral search with the city pair and dates filled in. No affiliate.',
            jsonLd: [seo.jsonLd.webPage({ name: 'Flights on OpenVibe.Tours', url: `${base()}/flights`, description: 'An official airline-neutral flight search with the city pair filled in.', siteUrl: base() })],
            body: raw(views.flightsPage({ values, result, error, providers: flights.providers })),
        });
    });

    // ── Trips ────────────────────────────────────────────────
    r.get('/trips', async (req, res) => {
        if (!signedIn(req)) return page(req, res, { index: false, cache: null, title: 'Trips', body: raw(views.signIn({ title: 'Your trips', text: 'A trip belongs to a signed-in person. Sign in to see yours or plan one.', next: '/trips' })) }, 401);
        const trips = await store.tripsForSubject(req.viewer.subject);
        return page(req, res, { index: false, cache: null, title: 'Your trips', body: raw(views.tripsPage({ trips })) });
    });

    r.get('/trips/new', async (req, res) => {
        if (!signedIn(req)) return page(req, res, { index: false, cache: null, title: 'Plan a trip', body: raw(views.signIn({ title: 'Plan a trip', text: 'A trip belongs to a signed-in person.', next: '/trips/new' })) }, 401);
        const cities = await store.listCities({ limit: 100 });
        return page(req, res, { index: false, cache: null, title: 'Plan a trip', body: raw(views.tripNew({ cities, values: { city: typeof req.query.city === 'string' ? req.query.city : '' } })) });
    });

    r.post('/trips', guard, async (req, res) => {
        const out = await store.createTrip({
            subject: req.viewer.subject, title: req.body.title, citySlug: req.body.city,
            startsOn: req.body.starts_on, endsOn: req.body.ends_on, notes: req.body.notes, visibility: 'private',
        });
        if (!out.ok) {
            const cities = await store.listCities({ limit: 100 });
            return page(req, res, { index: false, cache: null, title: 'Plan a trip', body: raw(views.tripNew({ cities, values: formValues(req.body, ['title', 'city', 'starts_on', 'ends_on', 'notes']), error: out.message })) }, 400);
        }
        return res.redirect(303, `/trips/${out.trip.slug}`);
    });

    r.get('/trips/:slug', async (req, res) => {
        const subject = signedIn(req) ? req.viewer.subject : null;
        const out = await store.tripBySlug(String(req.params.slug || ''), { subject });
        if (!out) return page(req, res, { index: false, cache: null, title: 'Not found', body: raw(views.notFound()) }, 404);
        const cities = out.mine ? await store.listCities({ limit: 100 }) : [];
        return page(req, res, {
            index: false, cache: out.mine ? null : 'public, max-age=60', title: out.trip.title,
            jsonLd: [tripJsonLd(out.trip, out.route)], body: raw(views.tripPage({ ...out, cities })),
        });
    });

    r.post('/trips/:slug/share', guard, async (req, res) => {
        const out = await store.updateTrip({ subject: req.viewer.subject, slug: String(req.params.slug || ''), input: { visibility: req.body.shared === '1' ? 'shared' : 'private' } });
        if (!out.ok) return page(req, res, { index: false, cache: null, title: 'Not found', body: raw(views.notFound()) }, out.status || 404);
        return res.redirect(303, `/trips/${out.trip.slug}`);
    });

    r.post('/trips/:slug/edit', guard, async (req, res) => {
        const out = await store.updateTrip({
            subject: req.viewer.subject, slug: String(req.params.slug || ''),
            input: { title: req.body.title, city_slug: req.body.city, starts_on: req.body.starts_on, ends_on: req.body.ends_on, notes: req.body.notes },
        });
        if (!out.ok) return page(req, res, { index: false, cache: null, title: 'Not found', body: raw(views.notFound()) }, out.status || 404);
        return res.redirect(303, `/trips/${out.trip.slug}`);
    });

    r.post('/trips/:slug/places', guard, async (req, res) => {
        const slug = /^trip-[a-z0-9]{16,32}$/.test(String(req.body.trip || '')) ? String(req.body.trip) : String(req.params.slug || '');
        const out = await store.addTripPlace({ subject: req.viewer.subject, slug, placeId: req.body.place_id, note: req.body.note });
        if (!out.ok) return page(req, res, { index: false, cache: null, title: 'Not found', body: raw(views.notFound()) }, out.status || 404);
        return res.redirect(303, `/trips/${slug}`);
    });

    r.post('/trips/:slug/places/:placeId/remove', guard, async (req, res) => {
        await store.removeTripPlace({ subject: req.viewer.subject, slug: String(req.params.slug || ''), placeId: String(req.params.placeId || '') });
        return res.redirect(303, `/trips/${String(req.params.slug || '')}`);
    });

    r.post('/trips/:slug/route', guard, async (req, res) => {
        const slug = /^trip-[a-z0-9]{16,32}$/.test(String(req.body.trip || '')) ? String(req.body.trip) : String(req.params.slug || '');
        const out = await store.setTripRoute({ subject: req.viewer.subject, slug, routeId: req.body.route_id || null });
        if (!out.ok) return page(req, res, { index: false, cache: null, title: 'Not found', body: raw(views.notFound()) }, out.status || 404);
        return res.redirect(303, `/trips/${slug}`);
    });

    r.post('/trips/:slug/stays', guard, async (req, res) => {
        const slug = /^trip-[a-z0-9]{16,32}$/.test(String(req.body.trip || '')) ? String(req.body.trip) : String(req.params.slug || '');
        const out = await store.addTripStay({ subject: req.viewer.subject, slug, stayId: req.body.stay_id });
        if (!out.ok) return page(req, res, { index: false, cache: null, title: 'Not found', body: raw(views.notFound()) }, out.status || 404);
        return res.redirect(303, `/trips/${slug}`);
    });

    r.post('/trips/:slug/stays/:stayId/remove', guard, async (req, res) => {
        await store.removeTripStay({ subject: req.viewer.subject, slug: String(req.params.slug || ''), stayId: String(req.params.stayId || '') });
        return res.redirect(303, `/trips/${String(req.params.slug || '')}`);
    });

    r.post('/trips/:slug/delete', guard, async (req, res) => {
        await store.deleteTrip({ subject: req.viewer.subject, slug: String(req.params.slug || '') });
        return res.redirect(303, '/trips');
    });

    // ── Developers ───────────────────────────────────────────
    r.get('/developers', async (req, res) => {
        const jobs = await store.latestJobRuns();
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, title: 'Developers',
            description: 'The OpenVibe.Tours API, its OpenAPI document, and the open-data sources and licences behind every city, place and route.',
            jsonLd: [seo.jsonLd.webPage({ name: 'The OpenVibe.Tours API', url: `${base()}/developers`, description: 'The JSON API and the open-data sources.', siteUrl: base() })],
            body: raw(views.developersPage({ jobs })),
        });
    });

    // ── Discovery ────────────────────────────────────────────
    r.use(createDiscoveryRoutes(ctx));
    return r;
}

module.exports = { createPageRoutes };
