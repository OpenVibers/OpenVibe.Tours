'use strict';

/**
 * Sign-in with OpenVibe.Network: OAuth 2 authorization code with PKCE (S256), as OAuth client `tours`.
 *
 *   GET  /auth/login      → Network /oauth/authorize (openvibe-sdk/sso: state, PKCE S256)
 *                           (?silent=1 adds prompt=none; ?next= a same-site path)
 *   GET  /auth/callback   → state check, server-side code exchange (client secret + code_verifier)
 *   GET  /auth/health     → does the Network accept this OAuth client? 503 only when it refuses it
 *   GET  /auth/logout     → clear cookies, revoke the refresh token (best effort)
 *   GET  /auth/me         → { user } for the shared navbar; { user: null } for a guest
 *
 * The OAuth half is openvibe-sdk/sso's (createSsoClient): the authorize URL, the PKCE S256 pair, the code and
 * refresh grants and the health check are the SDK's, not a hand copy. The session stays this site's own
 * httpOnly cookie (tours_at), so no script can read the token; neither token is stored server-side, rendered or
 * logged. The redirect URI is unchanged (<BASE_URL>/auth/callback).
 */
const crypto = require('crypto');
const express = require('express');
const cache = require('openvibe-shared/cache-policy');
const { createSsoClient, failurePage } = require('openvibe-sdk/sso');

const ACCESS_COOKIE = 'tours_at';
const REFRESH_COOKIE = 'tours_rt';
const HINT_COOKIE = 'ov_sso_hint';
const FLOW_COOKIE = 'tours_oauth';
const SITE_NAME = 'OpenVibe.Tours';

function ownOrigins(config) {
    const out = new Set();
    for (const u of [config && config.baseUrl, config && config.homes && config.homes.url]) {
        try { if (u) out.add(new URL(u).origin); } catch { /* not a URL */ }
    }
    return out;
}

/** Same-site relative paths only (never protocol-relative, never another origin). */
function sanitizeNext(next, config) {
    if (typeof next === 'string' && /[\u0000-\u001f\u007f\\]/.test(next)) return '/';
    if (typeof next === 'string' && /^https?:\/\//i.test(next)) {
        let u = null;
        try { u = new URL(next); } catch { return '/'; }
        if (!ownOrigins(config).has(u.origin)) return '/';
        next = `${u.pathname}${u.search}${u.hash}`;
    }
    if (typeof next !== 'string' || !/^\/(?!\/|\\)/.test(next) || next.length > 500) return '/';
    return next;
}

function createSso({ config, keys, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console }) {
    const cookieBase = () => ({ sameSite: 'lax', secure: config.cookies.secure, httpOnly: true, path: '/' });
    const sdkSso = createSsoClient({
        site: 'tours',
        siteName: SITE_NAME,
        baseUrl: config.baseUrl,
        clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret,
        redirectUri: config.oauth.redirectUri,
        scope: config.oauth.scope,
        networkUrl: config.networkUrl,
        networkInternalUrl: config.networkInternalUrl,
        secureCookies: config.cookies.secure,
        fetch: fetchImpl,
        log,
    });

    function setSession(res, data) {
        res.cookie(ACCESS_COOKIE, data.access_token, { ...cookieBase(), maxAge: 24 * 60 * 60 * 1000 });
        if (data.refresh_token) res.cookie(REFRESH_COOKIE, data.refresh_token, { ...cookieBase(), maxAge: 30 * 24 * 60 * 60 * 1000 });
        res.cookie(HINT_COOKIE, 'account', { sameSite: 'lax', secure: config.cookies.secure, httpOnly: false, path: '/', maxAge: 365 * 24 * 60 * 60 * 1000 });
    }
    function clearSession(res) {
        res.clearCookie(ACCESS_COOKIE, cookieBase());
        res.clearCookie(REFRESH_COOKIE, cookieBase());
    }

    /**
     * A Fun session is a Network SESSION token: audience openvibe.network and a person. FedCM assertions,
     * app/service tokens and internal tokens are signed with the same key and issuer; none may become a session here.
     */
    async function verifySession(token) {
        const v = await keys.verifyUser(token, { issuer: config.networkIssuer, audience: config.oauth.sessionAudience, now: now() });
        const c = v.claims;
        if (c && (c.typ === 'fedcm' || c.actor_type !== undefined)) return { ok: false, reason: 'not a session token' };
        return v;
    }

    function viewerFromClaims(claims, token) {
        const subject = typeof claims.subject_id === 'string' ? claims.subject_id : null;
        const role = typeof claims.role === 'string' ? claims.role : 'user';
        return {
            kind: 'user',
            subject,
            username: typeof claims.username === 'string' ? claims.username.slice(0, 64) : null,
            displayName: typeof claims.display_name === 'string' ? claims.display_name.slice(0, 80) : (typeof claims.username === 'string' ? claims.username.slice(0, 64) : 'you'),
            role,
            avatarUrl: typeof claims.avatar_url === 'string' && /^https:\/\/[^\s"'<>]{1,500}$/.test(claims.avatar_url) ? claims.avatar_url : null,
            profileColor: typeof claims.profile_color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(claims.profile_color) ? claims.profile_color : null,
            token,
        };
    }

    async function refresh(req, res) {
        if (!req.sessionRefresh) req.sessionRefresh = await doRefresh(req, res);
        return req.sessionRefresh;
    }

    async function doRefresh(req, res) {
        const rt = req.cookies && req.cookies[REFRESH_COOKIE];
        if (!rt) return null;
        try {
            const data = await sdkSso.tokenGrant({ grant_type: 'refresh_token', refresh_token: rt });
            setSession(res, data);
            const v = await verifySession(data.access_token);
            return v.ok ? viewerFromClaims(v.claims, data.access_token) : null;
        } catch (err) {
            if (err.status && err.status < 500) clearSession(res);
            return null;
        }
    }

    /** req.viewer for every page: the signed-in person, refreshed when their token expired. */
    function middleware() {
        return async (req, res, next) => {
            req.viewer = { kind: 'anonymous' };
            const token = req.cookies && req.cookies[ACCESS_COOKIE];
            if (!token) return next();
            await keys.ensure();
            const v = await verifySession(token);
            if (v.ok) { req.viewer = viewerFromClaims(v.claims, token); return next(); }
            if (v.expired) {
                const fresh = await refresh(req, res);
                if (fresh) { req.viewer = fresh; return next(); }
            }
            if (keys.loaded()) clearSession(res);
            next();
        };
    }

    async function asViewer(req, res, fn) {
        try {
            return await fn(req.viewer.token);
        } catch (err) {
            if (!err || err.status !== 401) throw err;
            const fresh = await refresh(req, res);
            if (!fresh) throw err;
            req.viewer = fresh;
            return fn(fresh.token);
        }
    }

    function routes() {
        const r = express.Router();
        const flowOpts = () => ({ ...cookieBase(), path: '/auth', maxAge: 10 * 60 * 1000 });

        r.get('/login', (req, res) => {
            const silent = Boolean(req.query.silent) && req.query.silent !== '0';
            const started = sdkSso.authorizeUrl({ silent });
            res.cookie(FLOW_COOKIE, JSON.stringify({ state: started.state, verifier: started.verifier, next: sanitizeNext(req.query.next, config), silent }), flowOpts());
            res.set('Cache-Control', cache.htmlHeaders({ private: true }));
            res.redirect(started.url);
        });

        r.get('/callback', async (req, res) => {
            res.set('Cache-Control', cache.htmlHeaders({ private: true }));
            let flow = null;
            try { flow = JSON.parse(req.cookies[FLOW_COOKIE] || 'null'); } catch { flow = null; }
            res.clearCookie(FLOW_COOKIE, { ...cookieBase(), path: '/auth' });
            const next = flow ? sanitizeNext(flow.next, config) : '/';
            const { code, state, error } = req.query;
            if (error) {
                if ((flow && flow.silent) || error === 'login_required' || error === 'interaction_required') return res.redirect(next);
                return res.status(400).type('text/plain').send(`Sign-in was not completed (${String(error).slice(0, 60)}).`);
            }
            if (!flow || typeof flow.state !== 'string' || typeof flow.verifier !== 'string' || typeof state !== 'string'
                || state.length !== flow.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))) {
                return res.status(400).type('text/plain').send('Sign-in state did not match. Please try signing in again.');
            }
            if (!code) {
                return res.status(400).type('html').send(failurePage({
                    siteName: SITE_NAME,
                    title: 'Sign-in didn\'t finish',
                    text: 'OpenVibe.Network sent no sign-in code. Start it again and it will go through; your account is fine.',
                    retryHref: `/auth/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`,
                    backHref: next || '/',
                }));
            }
            try {
                const data = await sdkSso.tokenGrant({ grant_type: 'authorization_code', code: String(code), redirect_uri: config.oauth.redirectUri, code_verifier: flow.verifier });
                setSession(res, data);
                res.set('Clear-Site-Data', '"cache"');
                return res.redirect(next);
            } catch (err) {
                const clientRefused = err.status === 401 || err.error === 'invalid_client' || err.error === 'unauthorized_client';
                if (clientRefused) {
                    log.error(`[OpenVibe.Tours] the Network refuses this site's OAuth client (${err.error || err.status}): check OV_OAUTH_CLIENT_ID / OV_OAUTH_CLIENT_SECRET`);
                    return res.status(500).type('html').send(failurePage({
                        siteName: SITE_NAME,
                        title: 'Sign-in isn\'t working on OpenVibe.Tours right now',
                        text: 'This is a problem on our side, not with your account, and it has been logged. Please try again a little later.',
                        retryHref: `/auth/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`,
                        backHref: next || '/',
                    }));
                }
                log.warn('[OpenVibe.Tours] sign-in exchange failed:', err.status || '', err.error || '');
                if (err.status && err.status < 500) {
                    return res.status(400).type('html').send(failurePage({
                        siteName: SITE_NAME,
                        title: 'Sign-in didn\'t finish',
                        text: 'The Network no longer accepts that sign-in code. Start it again and it will go through; your account is fine.',
                        retryHref: `/auth/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`,
                        backHref: next || '/',
                    }));
                }
                return res.status(502).type('html').send(failurePage({
                    siteName: SITE_NAME,
                    title: 'OpenVibe.Network didn\'t answer',
                    text: 'Your account is fine: the sign-in service did not reply in time. Try again in a moment.',
                    retryHref: `/auth/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`,
                    backHref: next || '/',
                }));
            }
        });

        // GET /auth/health: does the Network accept this site's OAuth client? 503 only when it refuses it.
        r.get('/health', async (_req, res) => {
            const client = await sdkSso.checkClient();
            res.set('Cache-Control', 'no-store');
            return res.status(client === 'invalid' ? 503 : 200).json({ ok: client !== 'invalid', client });
        });

        const sameOriginRequest = (req) => {
            const site = String(req.get('sec-fetch-site') || '');
            if (site) return site === 'same-origin' || (site === 'none' && req.method === 'GET');
            const origin = req.get('origin');
            if (origin) return origin === `${req.protocol}://${req.get('host')}`;
            return req.method === 'GET';
        };
        r.get('/logout', (req, res, next) => {
            if (sameOriginRequest(req)) return next();
            res.set('Cache-Control', cache.htmlHeaders({ private: true }));
            const q = req.query.next ? `?next=${encodeURIComponent(sanitizeNext(req.query.next, config))}` : '';
            res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Sign out</title><meta name="viewport" content="width=device-width,initial-scale=1">`
                + `<form method="post" action="/auth/logout${q}" style="font:16px system-ui;margin:3em auto;max-width:24em;text-align:center">`
                + `<p>Sign out of OpenVibe.Tours?</p><button type="submit">Sign out</button> <a href="/">Cancel</a></form>`);
        });
        r.post('/logout', (req, res, next) => (sameOriginRequest(req) ? next() : res.status(403).type('text/plain').send('Sign-out must come from this site.')));
        r.all('/logout', async (req, res) => {
            const rt = req.cookies && req.cookies[REFRESH_COOKIE];
            if (rt) {
                fetchImpl(`${config.networkInternalUrl}/oauth/revoke`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client_id: config.oauth.clientId, client_secret: config.oauth.clientSecret, token: rt }),
                    signal: AbortSignal.timeout(3000),
                }).catch(() => {});
            }
            clearSession(res);
            res.set('Clear-Site-Data', '"cache"');
            res.cookie(HINT_COOKIE, 'guest', { sameSite: 'lax', secure: config.cookies.secure, httpOnly: false, path: '/', maxAge: 365 * 24 * 60 * 60 * 1000 });
            res.redirect(303, sanitizeNext(req.query.next, config));
        });

        r.get('/me', (req, res) => {
            res.set('Cache-Control', cache.htmlHeaders({ private: true }));
            const c = req.cookies || {};
            if (!c[ACCESS_COOKIE] && !c[REFRESH_COOKIE] && !req.get('authorization')) return res.json({ user: null });
            const v = req.viewer;
            if (!v || v.kind !== 'user') return res.status(401).json({ error: 'Not signed in' });
            res.json({ user: { username: v.username, display_name: v.displayName, subject_id: v.subject, role: v.role, avatar_url: v.avatarUrl || null, profile_color: v.profileColor || null } });
        });

        // The shared Dock needs a verified Network access token from this HTTP-only session.
        r.get('/navbar-token', (req, res) => {
            res.set('Cache-Control', cache.htmlHeaders({ private: true }));
            const viewer = req.viewer;
            if (!viewer || viewer.kind !== 'user' || !viewer.token) return res.status(401).json({ error: 'Not signed in' });
            return res.json({ token: viewer.token });
        });
        return r;
    }

    return { middleware, routes, asViewer, tokenGrant: sdkSso.tokenGrant };
}

module.exports = { createSso, sanitizeNext, ownOrigins, ACCESS_COOKIE, REFRESH_COOKIE };
