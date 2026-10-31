'use strict';

/** The OpenAPI 3.1 document served at GET /api/v1/openapi.json. Public reads; trips are a signed-in person's. */
const problem = {
    type: 'object',
    required: ['type', 'title', 'status', 'code'],
    properties: {
        type: { type: 'string', format: 'uri' }, title: { type: 'string' }, status: { type: 'integer' },
        code: { type: 'string' }, detail: { type: 'string' }, request_id: { type: 'string' },
    },
};
const city = {
    type: 'object',
    properties: {
        id: { type: 'string', pattern: '^cty_[0-9A-HJKMNP-TV-Z]{26}$' }, slug: { type: 'string' }, name: { type: 'string' },
        country: { type: 'string' }, country_code: { type: ['string', 'null'] }, region: { type: ['string', 'null'] },
        lat: { type: 'number' }, lon: { type: 'number' }, population: { type: ['integer', 'null'] },
        wikidata_id: { type: 'string' }, wikivoyage_title: { type: ['string', 'null'] }, summary: { type: ['string', 'null'] },
        image_url: { type: ['string', 'null'] }, image_credit: { type: ['string', 'null'] }, image_license: { type: ['string', 'null'] },
        image_license_url: { type: ['string', 'null'] }, source: { type: 'string' }, source_url: { type: 'string', format: 'uri' },
        fetched_at: { type: 'string', format: 'date-time' }, place_count: { type: 'integer' }, route_count: { type: 'integer' },
    },
};
const place = {
    type: 'object',
    properties: {
        id: { type: 'string', pattern: '^plc_[0-9A-HJKMNP-TV-Z]{26}$' }, city_id: { type: 'string' }, city_slug: { type: ['string', 'null'] },
        city_name: { type: ['string', 'null'] }, osm_type: { type: 'string', enum: ['node', 'way', 'relation'] }, osm_id: { type: 'string' },
        name: { type: 'string' }, kind: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' },
        address: { type: ['string', 'null'] }, website: { type: ['string', 'null'] }, opening_hours: { type: ['string', 'null'] },
        wheelchair: { type: ['string', 'null'] }, fee: { type: ['string', 'null'] }, wikidata_id: { type: ['string', 'null'] },
        image_url: { type: ['string', 'null'] }, image_credit: { type: ['string', 'null'] }, image_license: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] }, source: { type: 'string' }, source_url: { type: 'string', format: 'uri' },
        fetched_at: { type: 'string', format: 'date-time' }, osm_url: { type: 'string', format: 'uri' }, map_url: { type: 'string', format: 'uri' },
    },
};
const stop = {
    type: 'object',
    properties: {
        position: { type: 'integer' }, place_id: { type: ['string', 'null'] }, title: { type: 'string' }, note: { type: ['string', 'null'] },
        lat: { type: 'number' }, lon: { type: 'number' }, source: { type: 'string' }, source_url: { type: 'string', format: 'uri' },
        audio_status: { type: 'string', enum: ['none', 'ready'] }, audio_url: { type: ['string', 'null'] }, map_url: { type: 'string', format: 'uri' },
    },
};
const route = {
    type: 'object',
    properties: {
        id: { type: 'string', pattern: '^rte_[0-9A-HJKMNP-TV-Z]{26}$' }, city_id: { type: 'string' }, city_slug: { type: ['string', 'null'] },
        city_name: { type: ['string', 'null'] }, slug: { type: 'string' }, title: { type: 'string' }, summary: { type: ['string', 'null'] },
        source: { type: 'string' }, source_url: { type: 'string', format: 'uri' }, fetched_at: { type: 'string', format: 'date-time' },
        distance_m: { type: 'integer' }, duration_min: { type: 'integer' }, stop_count: { type: 'integer' }, generated: { type: 'boolean' },
        stops: { type: 'array', items: { $ref: '#/components/schemas/Stop' } },
    },
};
const live = {
    type: 'object',
    properties: {
        id: { type: 'string' }, kind: { type: 'string', enum: ['stream', 'vod', 'clip'] }, username: { type: 'string' }, display_name: { type: ['string', 'null'] },
        title: { type: 'string' }, category: { type: ['string', 'null'] }, thumbnail_url: { type: ['string', 'null'] },
        viewer_count: { type: 'integer' }, city_id: { type: ['string', 'null'] }, city_name: { type: ['string', 'null'] },
        url: { type: 'string', format: 'uri' }, started_at: { type: ['string', 'null'] }, ended_at: { type: ['string', 'null'] },
        fetched_at: { type: 'string', format: 'date-time' },
    },
};
const stay = {
    type: 'object',
    properties: {
        id: { type: 'string' }, external_id: { type: 'string' }, city_id: { type: ['string', 'null'] }, city_name: { type: 'string' },
        title: { type: 'string' }, kind: { type: 'string' }, price: { type: 'number' }, currency: { type: 'string' },
        period: { type: 'string' }, neighbourhood: { type: ['string', 'null'] }, url: { type: 'string', format: 'uri' },
        fetched_at: { type: 'string', format: 'date-time' },
    },
};
const trip = {
    type: 'object',
    properties: {
        id: { type: 'string' }, slug: { type: 'string' }, title: { type: 'string' }, city_id: { type: ['string', 'null'] },
        city_slug: { type: ['string', 'null'] }, city_name: { type: ['string', 'null'] }, starts_on: { type: 'string', format: 'date' },
        ends_on: { type: 'string', format: 'date' }, notes: { type: ['string', 'null'] }, visibility: { type: 'string', enum: ['private', 'shared'] },
        revision: { type: 'integer' }, created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' },
    },
};

const json = (schema) => ({ '200': { description: 'OK', content: { 'application/json': { schema } } }, default: { description: 'A problem', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } } });
const unauth = { '401': { description: 'Sign in required' }, '403': { description: 'Not yours, or a cross-site session write' }, '404': { description: 'Not found' }, '429': { description: 'Rate limited' } };
const pathParam = (name, example) => ({ name, in: 'path', required: true, schema: { type: 'string' }, example });
const query = (name, schema, description) => ({ name, in: 'query', required: false, schema, description });

const document = {
    openapi: '3.1.0',
    info: {
        title: 'OpenVibe.Tours API',
        version: '0.1.0',
        description: 'Go anywhere: fly, stay, walk, watch. Cities, places, self-guided routes, IRL tours from OpenVibe.Live, stays from OpenVibe.Rent, and a signed-in person\'s trips. Public data carries its source and fetch time.',
        license: { name: 'AGPL-3.0-only', url: 'https://www.gnu.org/licenses/agpl-3.0.en.html' },
    },
    servers: [{ url: 'https://openvibe.tours', description: 'production' }],
    paths: {
        '/api/v1/ping': { get: { summary: 'Liveness', responses: json({ type: 'object', properties: { ok: { type: 'boolean' }, service: { type: 'string' } } }) } },
        '/api/v1/cities': {
            get: {
                summary: 'List the top cities', tags: ['Cities'],
                parameters: [query('limit', { type: 'integer', minimum: 1, maximum: 200, default: 100 }), query('offset', { type: 'integer', minimum: 0, default: 0 }), query('q', { type: 'string', maxLength: 80 })],
                responses: json({ type: 'object', properties: { count: { type: 'integer' }, cities: { type: 'array', items: { $ref: '#/components/schemas/City' } } } }),
            },
        },
        '/api/v1/cities/{slug}': {
            get: {
                summary: 'One city with its places and routes', tags: ['Cities'], parameters: [pathParam('slug', 'lisbon')],
                responses: { ...json({ type: 'object', properties: { city: { $ref: '#/components/schemas/City' }, places: { type: 'array', items: { $ref: '#/components/schemas/Place' } }, routes: { type: 'array', items: { $ref: '#/components/schemas/Route' } }, live: { type: 'array', items: { $ref: '#/components/schemas/Live' } }, stays: { type: 'array', items: { $ref: '#/components/schemas/Stay' } } } }), '404': { description: 'No such city' } },
            },
        },
        '/api/v1/places/{id}': {
            get: { summary: 'One place', tags: ['Places'], parameters: [pathParam('id', 'plc_01JABCDEFGHJKMNPQRSTVWXYZ0')], responses: { ...json({ type: 'object', properties: { place: { $ref: '#/components/schemas/Place' }, routes: { type: 'array', items: { $ref: '#/components/schemas/Route' } } } }), '404': { description: 'No such place' } } },
        },
        '/api/v1/routes/{id}': {
            get: { summary: 'One route with its ordered stops', tags: ['Routes'], parameters: [pathParam('id', 'rte_01JABCDEFGHJKMNPQRSTVWXYZ0')], responses: { ...json({ type: 'object', properties: { route: { $ref: '#/components/schemas/Route' } } }), '404': { description: 'No such route' } } },
        },
        '/api/v1/live': {
            get: {
                summary: 'IRL tours now and recent IRL VODs', tags: ['Live'],
                responses: json({ type: 'object', properties: { live: { type: 'array', items: { $ref: '#/components/schemas/Live' } }, recent: { type: 'array', items: { $ref: '#/components/schemas/Live' } }, source: { type: 'string' }, fetched_at: { type: ['string', 'null'] } } }),
            },
        },
        '/api/v1/openapi.json': { get: { summary: 'This document', responses: { '200': { description: 'OpenAPI 3.1 JSON' } } } },
        '/api/v1/trips': {
            get: { summary: 'Your trips', tags: ['Trips'], responses: { ...json({ type: 'object', properties: { trips: { type: 'array', items: { $ref: '#/components/schemas/Trip' } } } }), ...unauth } },
            post: {
                summary: 'Create a trip', tags: ['Trips'],
                requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title', 'city_slug', 'starts_on', 'ends_on'], properties: { title: { type: 'string', minLength: 3, maxLength: 120 }, city_slug: { type: 'string' }, starts_on: { type: 'string', format: 'date' }, ends_on: { type: 'string', format: 'date' }, notes: { type: 'string', maxLength: 2000 }, visibility: { type: 'string', enum: ['private', 'shared'] } } } } } },
                responses: { '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Trip' } } } }, '400': { description: 'Invalid trip' }, ...unauth },
            },
        },
        '/api/v1/trips/{slug}': {
            get: { summary: 'Your trip, or a shared one read-only', tags: ['Trips'], parameters: [pathParam('slug', 'trip-0123456789abcdef01234567')], responses: { ...json({ type: 'object', properties: { trip: { $ref: '#/components/schemas/Trip' }, mine: { type: 'boolean' }, places: { type: 'array', items: { $ref: '#/components/schemas/Place' } }, route: { oneOf: [{ $ref: '#/components/schemas/Route' }, { type: 'null' }] }, stays: { type: 'array', items: { $ref: '#/components/schemas/Stay' } } } }), '404': { description: 'No such trip, or it is private' } } },
            patch: { summary: 'Edit your trip', tags: ['Trips'], parameters: [pathParam('slug', 'trip-0123456789abcdef01234567')], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, city_slug: { type: 'string' }, starts_on: { type: 'string', format: 'date' }, ends_on: { type: 'string', format: 'date' }, notes: { type: 'string' }, visibility: { type: 'string', enum: ['private', 'shared'] } } } } } }, responses: { ...json({ $ref: '#/components/schemas/Trip' }), ...unauth } },
            delete: { summary: 'Delete your trip', tags: ['Trips'], parameters: [pathParam('slug', 'trip-0123456789abcdef01234567')], responses: { '204': { description: 'Deleted' }, ...unauth } },
        },
        '/api/v1/trips/{slug}/places': {
            post: { summary: 'Save a place to your trip', tags: ['Trips'], parameters: [pathParam('slug', 'trip-0123456789abcdef01234567')], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['place_id'], properties: { place_id: { type: 'string' }, note: { type: 'string', maxLength: 500 } } } } } }, responses: { '201': { description: 'Saved' }, ...unauth } },
        },
        '/api/v1/trips/{slug}/places/{placeId}': {
            delete: { summary: 'Remove a place from your trip', tags: ['Trips'], parameters: [pathParam('slug', 'trip-0123456789abcdef01234567'), pathParam('placeId', 'plc_01JABCDEFGHJKMNPQRSTVWXYZ0')], responses: { '204': { description: 'Removed' }, ...unauth } },
        },
        '/api/v1/trips/{slug}/route': {
            post: { summary: 'Set or clear the trip route', tags: ['Trips'], parameters: [pathParam('slug', 'trip-0123456789abcdef01234567')], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { route_id: { type: ['string', 'null'] } } } } } }, responses: { '200': { description: 'Set' }, ...unauth } },
        },
        '/api/v1/trips/{slug}/stays': {
            post: { summary: 'Add a stay to your trip', tags: ['Trips'], parameters: [pathParam('slug', 'trip-0123456789abcdef01234567')], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['stay_id'], properties: { stay_id: { type: 'string' } } } } } }, responses: { '201': { description: 'Added' }, ...unauth } },
        },
        '/api/v1/trips/{slug}/stays/{stayId}': {
            delete: { summary: 'Remove a stay from your trip', tags: ['Trips'], parameters: [pathParam('slug', 'trip-0123456789abcdef01234567'), pathParam('stayId', 'sty_01JABCDEFGHJKMNPQRSTVWXYZ0')], responses: { '204': { description: 'Removed' }, ...unauth } },
        },
    },
    components: {
        schemas: { Problem: problem, City: city, Place: place, Stop: stop, Route: route, Live: live, Stay: stay, Trip: trip },
        securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'tours_at' }, bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
    tags: [{ name: 'Cities' }, { name: 'Places' }, { name: 'Routes' }, { name: 'Live' }, { name: 'Trips' }],
};

module.exports = { document };
