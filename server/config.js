'use strict';

/**
 * OpenVibe.Tours configuration. Every value comes from the environment (production: /etc/openvibe/tours.env, see
 * README). Only environment variable NAMES appear in code and docs; secrets are never logged.
 *
 * load(env) is pure so tests can build a config without touching process.env.
 */
require('dotenv').config();
const trim = (s) => String(s || '').replace(/\/+$/, '');
const int = (v, def) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);
const bool = (v, def = false) => (v == null || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

function load(env = process.env) {
    const nodeEnv = env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';
    const port = int(env.PORT, 5170);
    const baseUrl = trim(env.BASE_URL || (isProduction ? 'https://openvibe.tours' : `http://localhost:${port}`));
    const networkUrl = trim(env.OV_NETWORK_URL || 'https://openvibe.network');
    const duffelKey = String(env.TOURS_DUFFEL_API_KEY || '').trim();
    const kiwiKey = String(env.TOURS_KIWI_API_KEY || '').trim();

    return {
        service: 'tours',
        port,
        host: env.HOST || '127.0.0.1',
        nodeEnv,
        isProduction,
        baseUrl,
        trustProxy: env.TRUST_PROXY != null ? Number(env.TRUST_PROXY) : 2,
        drill: bool(env.TOURS_DRILL),
        limits: {
            minute: Math.max(1, int(env.TOURS_LIMITS_MINUTE, 120)),
            hour: Math.max(1, int(env.TOURS_LIMITS_HOUR, 3000)),
        },

        db: { url: env.DATABASE_URL || '', directUrl: env.DATABASE_DIRECT_URL || '', pgliteDir: env.TOURS_PGLITE_DIR || '' },
        valkey: { url: env.VALKEY_URL || '', prefix: env.VALKEY_PREFIX || 'ov:tours:' },

        networkUrl,
        networkInternalUrl: trim(env.OV_NETWORK_INTERNAL_URL || 'http://127.0.0.1:4000'),
        networkIssuer: trim(env.OV_NETWORK_ISSUER || networkUrl),
        audience: env.TOURS_AUDIENCE || 'openvibe.tours',
        oauth: {
            clientId: env.OV_OAUTH_CLIENT_ID || 'tours',
            clientSecret: env.OV_OAUTH_CLIENT_SECRET || '',
            redirectUri: env.OV_OAUTH_REDIRECT_URI || `${baseUrl}/auth/callback`,
            scope: 'profile',
            sessionAudience: env.OV_SESSION_AUDIENCE || 'openvibe.network',
        },
        cookies: { secure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction },

        events: {
            secrets: String(env.TOURS_EVENTS_SECRET || '').split(',').map((x) => x.trim()).filter(Boolean),
            url: trim(env.TOURS_EVENTS_URL || env.EVENTS_URL || ''),
            endpoint: env.TOURS_EVENTS_ENDPOINT || '',
            intervalMs: Math.max(500, int(env.TOURS_EVENTS_INTERVAL_MS, 5000)),
            scope: env.TOURS_EVENTS_SCOPE || 'events.subscription.manage',
        },

        // The public APIs and open data Tours reads. Every request identifies itself, is paced per host and stores
        // its source URL and fetch time. No key is required for any of them.
        upstreams: {
            live: trim(env.OV_LIVE_URL || 'https://openvibe.live'),
            livePublic: trim(env.OV_LIVE_PUBLIC_URL || 'https://openvibe.live'),
            video: trim(env.OV_VIDEO_PUBLIC_URL || 'https://openvibe.video'),
            rent: trim(env.OV_RENT_URL || 'https://openvibe.rent'),
            rentPublic: trim(env.OV_RENT_PUBLIC_URL || 'https://openvibe.rent'),
            wikivoyage: trim(env.OV_WIKIVOYAGE_URL || 'https://en.wikivoyage.org'),
            wikidata: trim(env.OV_WIKIDATA_URL || 'https://www.wikidata.org'),
            wikipedia: trim(env.OV_WIKIPEDIA_URL || 'https://en.wikipedia.org'),
            commons: trim(env.OV_COMMONS_URL || 'https://commons.wikimedia.org'),
            overpass: trim(env.OV_OVERPASS_URL || 'https://overpass-api.de/api/interpreter'),
            timeoutMs: Math.max(1000, int(env.TOURS_UPSTREAM_TIMEOUT_MS, 60_000)),
        },

        // OpenStreetMap/Overpass obligations: identify every request, pace it per host, bound the query by radius.
        openData: {
            userAgent: env.TOURS_USER_AGENT || `OpenVibeTours/0.1 (+${baseUrl}; contact@openvibe.network)`,
            email: String(env.TOURS_OSM_EMAIL || '').trim(),
            minIntervalMs: Math.max(0, int(env.TOURS_MIN_INTERVAL_MS, 1100)),
            retryAfterMs: Math.max(0, int(env.TOURS_RETRY_AFTER_MS, 120_000)),
            radiusM: Math.min(10_000, Math.max(300, int(env.TOURS_OSM_RADIUS_M, 3500))),
            maxPerCity: Math.min(200, Math.max(1, int(env.TOURS_OSM_MAX_PER_CITY, 80))),
            osmCitiesPerRun: Math.min(100, Math.max(0, int(env.TOURS_OSM_CITIES_PER_RUN, 10))),
            cityLimit: Math.min(200, Math.max(1, int(env.TOURS_CITY_LIMIT, 100))),
            districtPages: Math.min(4, Math.max(0, int(env.TOURS_WIKIVOYAGE_DISTRICTS, 2))),
        },

        jobs: {
            enabled: bool(env.TOURS_JOBS, true),
            intervalMs: Math.max(60_000, int(env.TOURS_JOBS_INTERVAL_MS, 6 * 60 * 60 * 1000)),
            citiesEveryMs: Math.max(60_000, int(env.TOURS_CITIES_INTERVAL_MS, 24 * 60 * 60 * 1000)),
            placesEveryMs: Math.max(60_000, int(env.TOURS_PLACES_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000)),
            routesEveryMs: Math.max(60_000, int(env.TOURS_ROUTES_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000)),
            liveEveryMs: Math.max(30_000, int(env.TOURS_LIVE_INTERVAL_MS, 2 * 60 * 1000)),
            staysEveryMs: Math.max(60_000, int(env.TOURS_STAYS_INTERVAL_MS, 6 * 60 * 60 * 1000)),
        },

        // No flight API key is configured in v1. The form builds the airline-neutral official search link and the
        // Duffel/Kiwi seam stays off; a key alone does not turn a provider on until an adapter exists.
        flights: {
            provider: env.TOURS_FLIGHTS_PROVIDER || 'none',
            duffel: { enabled: Boolean(duffelKey), key: duffelKey },
            kiwi: { enabled: Boolean(kiwiKey), key: kiwiKey },
            searchBase: trim(env.TOURS_FLIGHTS_SEARCH_URL || 'https://www.google.com/travel/flights'),
        },

        // OpenVibe.AI has no speech-synthesis route today (GET /api/v1/... has chat, generate, summarize, classify,
        // extract, embed, image and research). Route stops therefore carry audio_status "none" and a plain note.
        tts: { enabled: false, aiUrl: trim(env.OV_AI_URL || 'https://openvibe.ai') },
    };
}

module.exports = { load };
