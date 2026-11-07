'use strict';

/**
 * OpenVibe.Tours — Express app factory; server/index.js listens, tests build their own instance with a temp database
 * and a mock Network/the open-data fixtures.
 *
 *   /, /cities, /city/:slug, /place/:id, /routes, /routes/:id, /live, /stays, /flights,
 *   /trips, /trips/new, /trips/:slug, /developers, 404                     the pages (http/pages.js)
 *   /api/v1/*                                                              the API (http/api.js)
 *   /auth/*                                                                Network SSO with PKCE (auth/sso.js)
 *   /api/health, /api/ready, /release.json, /metrics                       machine endpoints
 *   /internal/events                                                       account deletion (loopback only)
 *
 * The source jobs are created here (ctx.jobs) but started by server/index.js, and never under TOURS_DRILL.
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const contracts = require('openvibe-contracts');
const cache = require('openvibe-shared/cache-policy');

const configLib = require('./config');
const { openStore, createStore } = require('./db');
const { createKeyStore } = require('./auth/keys');
const { createSso } = require('./auth/sso');
const { createPrincipal } = require('./http/principal');
const { createApi } = require('./http/api');
const { createPageRoutes } = require('./http/pages');
const { createSharing } = require('./sharing');
const { createServiceReadiness } = require('./observability');
const { assetVersion, send } = require('./render/layout');
const { raw } = require('./render/html');
const { createStore: dataStore } = require('./store');
const { createJobs } = require('./jobs');
const { createSearchIndex } = require('./search-index');
const accountDataLib = require('./identity/account-data');
const { createNetworkSender } = require('openvibe-sdk/account-data');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
const { createHttpTelemetry } = require('openvibe-sdk/service');
const { createPgTelemetrySink } = require('openvibe-sdk/telemetry');

/** opts: config, store, now (clock), fetchImpl, log, valkey, accountSend, telemetrySink. */
async function createApp(opts = {}) {
    const config = opts.config || configLib.load();
    const log = opts.log || console;
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const s = opts.store || await openStore(config, { now: opts.now, log });

    const keys = createKeyStore({ config, fetchImpl, log });
    const sso = createSso({ config, keys, fetchImpl, now: s.now, log });
    const principal = createPrincipal({ config, keys });
    // The one sharing system (design 2026-11-06): a trip is its owner's until the Share sheet says otherwise.
    const sharing = opts.sharing || createSharing({ db: s.db, config, fetchImpl, log });
    const store = dataStore(s, { config, sharing });
    const jobs = createJobs({ config, s, store, fetchImpl, log });
    // The places, cities and walks in OpenVibe.Search (started by server/index.js, never under TOURS_DRILL).
    const searchIndex = createSearchIndex({ config, s, log });

    const accountData = accountDataLib.create({ db: s.db, log });
    const accountSend = opts.accountSend || (config.oauth.clientSecret
        ? createNetworkSender({ networkInternalUrl: config.networkInternalUrl, clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret, fetch: fetchImpl })
        : async () => { throw new Error('OV_OAUTH_CLIENT_SECRET is not set: Tours cannot answer account events'); });

    const ctx = { config, s, keys, sso, principal, store, jobs, searchIndex, accountData, accountSend, sharing, log };

    const app = express();
    // /.well-known/agent.json (openvibe-shared/agent-layer, SEO-2): what this site serves, for agents.
    require('openvibe-shared/agent-layer').mount(app, { descriptor: require('./agent-descriptor') });
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    const release = require('openvibe-shared/release').createRelease({ service: 'tours', root: path.join(__dirname, '..') });
    require('./render/layout').setRelease(release.release);
    const metrics = require('openvibe-shared/metrics').instrument(app, { service: 'tours', release: release.release });
    app.locals.metrics = metrics.registry;
    ctx.telemetry = createHttpTelemetry({ service: 'tours', sink: opts.telemetrySink || createPgTelemetrySink({ db: s.db, log }), skipPrefixes: ['/shared'], intervalMs: 60_000 });
    app.use(ctx.telemetry.middleware());
    app.locals.ctx = ctx;

    const valkey = opts.valkey !== undefined ? opts.valkey : (config.valkey.url ? require('openvibe-sdk/valkey').createValkey({ url: config.valkey.url, prefix: config.valkey.prefix, log }) : null);
    ctx.valkey = valkey;

    app.use(contracts.http.middleware());
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", 'https://openvibe.network', 'https://static.cloudflareinsights.com', 'https://unpkg.com'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://openvibe.network', 'https://fonts.googleapis.com', 'https://unpkg.com'],
                fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
                imgSrc: ["'self'", 'data:', 'https://openvibe.network', 'https://openvibe.live', 'https://openvibe.rent', 'https://upload.wikimedia.org', 'https://thumb.wikimedia.org', 'https://openvibe.media', 'https://commons.wikimedia.org', 'https://*.tile.openstreetmap.org', 'https://unpkg.com'],
                // The navbar's Messages count asks Chat (openvibe-shared 4.130.0).
                connectSrc: ["'self'", 'https://openvibe.chat', 'https://openvibe.network', 'https://cloudflareinsights.com', 'https://openvibe.live', 'https://openvibe.rent', 'https://*.tile.openstreetmap.org', 'https://unpkg.com', 'https://openvibe.events'],
                workerSrc: ["'self'", 'blob:'],
                frameSrc: ["'self'", 'https://openvibe.network'],
                frameAncestors: ["'none'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'", 'https://openvibe.network'],
            },
        },
        frameguard: { action: 'deny' },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'same-site' },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }));
    app.use(cookieParser());

    // ── Machine endpoints ───────────────────────────────────
    app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'openvibe-tours', name: 'OpenVibe.Tours', version: VERSION }));
    release.mount(app, { registry: metrics.registry });
    const readiness = createServiceReadiness({ s, config, release: release.release, valkey });
    app.get('/api/ready', readiness.handler);

    // ── Who is asking (verified offline; refreshed when expired) ──
    app.use(sso.middleware());

    // ── Sign-in (OAuth2 + PKCE client of OpenVibe.Network) ──
    app.use('/auth/', rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));
    app.use('/auth', sso.routes());
    { const legal = require('openvibe-shared/legal'); app.get(legal.PATHS, legal.handler({ id: 'tours', service: 'tours', host: 'openvibe.tours', name: 'OpenVibe.Tours', profile: 'ugc' })); }

    // ── OpenVibe.Events → this service (loopback only) ──────
    app.use('/internal/events', accountData.consumer({
        secrets: config.events.secrets,
        send: accountSend,
        now: s.now,
        onEvent: async (ev) => `ignored:${ev.event_type}`,
    }));

    // ── Static assets (content-hashed ?v= → immutable) ──────
    app.use('/shared', require('openvibe-shared/serve').handler());
    app.use(express.static(PUBLIC_DIR, {
        index: false, redirect: false,
        setHeaders(res, filePath) {
            const rel = path.relative(PUBLIC_DIR, filePath).split(path.sep).join('/');
            const v = res.req && res.req.query && res.req.query.v;
            res.setHeader('Cache-Control', cache.assetHeaders(rel, { hashed: !!v && v === assetVersion(rel) }));
        },
    }));

    // ── API ─────────────────────────────────────────────────
    app.use('/api/v1', rateLimit({ windowMs: 60_000, limit: Number(process.env.TOURS_API_RATE_LIMIT_PER_MIN) || 240, standardHeaders: true, legacyHeaders: false, handler: (req, res) => contracts.http.sendProblem(res, 429, 'rate_limited', { detail: 'too many requests from this address; retry shortly', ctx: req.ov }) }));
    // ── /api/v1/trip/:slug/share — the one Share sheet's API (openvibe-sdk/share) ──
    // GET/PUT .../share, .../share/requests, .../share/transfer[/accept|decline|cancel], GET /api/v1/share/people
    // and /api/v1/shared-with-me. Access is still decided by canView on every read path; the router answers only
    // its own paths.
    {
        const shareApi = express.Router();
        shareApi.use(sharing.shares.router({
            service: 'tours',
            authenticate: (req) => sharing.shareViewer(req.viewer),
            describe: sharing.describe,
        }));
        const SHARE_PATH = /^\/api\/v1\/(?:shared-with-me$|share\/people$|[^/]+\/[^/]+\/share(?:\/|$))/;
        app.use((req, res, next) => (SHARE_PATH.test(req.path) ? shareApi(req, res, next) : next()));
    }
    // Expire members and transfers and send queued share events/notifications. Unref'd: it never holds a test open.
    if (opts.startSharingWorker !== false) {
        const timer = setInterval(() => { sharing.work().catch(() => { /* logged inside */ }); }, 15_000);
        if (timer.unref) timer.unref();
        app.locals.sharingTimer = timer;
    }
    app.use('/api/v1', createApi(ctx));
    // GET /openapi.json (SEO-3): the API's OpenAPI 3.1 document, the same one /api/v1/openapi.json serves.
    app.get('/openapi.json', (_req, res) => res.set('Cache-Control', 'public, max-age=3600').set('Access-Control-Allow-Origin', '*').json(require('./openapi').document));
    app.use('/api', (req, res) => contracts.http.sendProblem(res, 404, 'route.not_found', { detail: 'No such API route', ctx: req.ov }));

    // ── Pages ───────────────────────────────────────────────
    app.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.TOURS_RATE_LIMIT_PER_MIN) || 300, standardHeaders: true, legacyHeaders: false }));
    const pageRoutes = createPageRoutes(ctx);
    // The Markdown twins of the public pages, and the head link and Link: header that name them (SEO-1,
    // server/agent-twins.js): a twin is the page rendered signed out.
    require('./agent-twins').mountTwins(app, { router: pageRoutes, descriptor: require('./agent-descriptor'), baseUrl: ctx.config.baseUrl });
    app.use(pageRoutes);
    app.use((req, res) => send(res, 404, {
        viewer: req.viewer, config, path: req.originalUrl, title: 'Not found',
        body: raw(require('./views').notFound()),
    }));

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => {
        log.error('[OpenVibe.Tours]', err && err.message ? err.message.slice(0, 300) : err);
        if (res.headersSent) return;
        res.set('Cache-Control', cache.htmlHeaders({ private: true }));
        if (err && err.type === 'entity.parse.failed') return contracts.http.sendProblem(res, 400, 'request.malformed_json', { ctx: req.ov });
        if (err && err.type === 'entity.too.large') return req.path.startsWith('/api/') ? contracts.http.sendProblem(res, 413, 'request.too_large', { ctx: req.ov }) : res.status(413).type('text/plain').send('That request was too large.');
        if (req.path.startsWith('/api/')) return contracts.http.sendProblem(res, 500, 'internal.error', { detail: 'Internal error', ctx: req.ov });
        res.status(500).type('text/plain').send('Something went wrong on our side. Try again in a moment.');
    });

    return { app, ctx };
}

module.exports = { createApp };
