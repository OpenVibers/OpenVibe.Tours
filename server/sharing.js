'use strict';

/**
 * Sharing on OpenVibe.Tours (design 2026-11-06, visibility step 3), through openvibe-sdk/share.
 *
 * A trip is Only me until its owner says otherwise. The Share sheet changes just that trip; the person's default for
 * new trips lives on /trips ("New trips: Only me"). The trip's page and every API read ask the one check, canView;
 * editing (places, route, stays, title) asks canEdit, so a trip shared with Specific people Can edit is one the
 * household or the people going together can actually plan.
 *
 * The SDK owns the model and the rules (the shares row, members, requests, transfers, the log and the delivery
 * queue). This file is the wiring: Network's name lookups and notifications, Events for share.* envelopes, the old
 * visibility column kept in step (so an old reader fails closed), and the person's default.
 */
const { createShares } = require('openvibe-sdk/share');
const { serviceAuth } = require('openvibe-contracts');

const SERVICE = 'tours';
const KIND = 'trip';
const AUDIENCES = ['public', 'link', 'people', 'private'];
const DEFAULT_AUDIENCE = 'private';
/** The old two words, kept for readers and fixtures that predate the share row. */
const VISIBILITY = { public: 'shared', link: 'shared', people: 'private', private: 'private' };

const refOf = (slug) => ({ service: SERVICE, kind: KIND, id: String(slug) });

/** Tours' viewer as the SDK wants it: a subject object. Tours has no staff bit on a page viewer. */
function shareViewer(v) {
    if (!v || !v.subject) return null;
    if (String(v.subject).startsWith('usr_')) return { subject: { type: 'user', id: v.subject }, staff: !!v.staff };
    return null;
}

function createSharing({ db, config, fetchImpl = globalThis.fetch, log = console } = {}) {
    const base = String(config.networkInternalUrl || '').replace(/\/+$/, '');
    const tokens = config.oauth && config.oauth.clientSecret ? serviceAuth.createTokenClient({
        tokenUrl: base + '/oauth/token',
        clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret,
        audience: 'openvibe.network',
        scope: 'identity.subject.resolve network.notifications.push',
        fetch: fetchImpl,
    }) : null;

    async function networkJson({ path, method = 'GET', json, query } = {}) {
        if (!tokens) throw new Error('Network is not configured for this service');
        const url = new URL(base + path);
        for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
        const headers = { Accept: 'application/json', ...(await tokens.authHeaders()) };
        if (json !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetchImpl(url, { method, headers, body: json === undefined ? undefined : JSON.stringify(json), signal: AbortSignal.timeout(8000) });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            const err = new Error('Network ' + method + ' ' + path + ' ' + res.status + ': ' + ((body && (body.detail || body.error)) || 'failed'));
            err.status = res.status;
            throw err;
        }
        return body;
    }

    /** One notification. It never carries the trip's title, its places or its notes. */
    async function notify(n) {
        const to = n && n.to;
        if (!to || to.type !== 'user') return;
        const words = {
            'share.added': ['A trip was shared with you', 'Open it on OpenVibe.Tours.'],
            'share.access_requested': ['Someone asked for access to your trip', 'Review the request on OpenVibe.Tours.'],
            'share.transfer.requested': ['Someone wants to give you a trip', 'Accept or decline it on OpenVibe.Tours.'],
            'share.transfer.answered': ['A trip transfer was answered', 'See what happened on OpenVibe.Tours.'],
        }[n.kind] || ['Sharing on OpenVibe.Tours', 'There is something new for you.'];
        try {
            await networkJson({
                path: '/internal/notifications/push', method: 'POST',
                json: {
                    subject: to.id, type: 'GENERIC', title: words[0], message: words[1],
                    service: 'tours', url: n.ref && n.ref.id ? `${config.baseUrl}/trips/${encodeURIComponent(n.ref.id)}` : `${config.baseUrl}/trips`,
                    category: 'social',
                },
            });
        } catch (err) {
            // Network may not have seeded Tours' network.notifications.push grant yet: the share still happened
            // (it is decided by canView), the person just hears about it elsewhere.
            log.warn('[Sharing] notification not sent:', err.message);
        }
    }

    /** OpenVibe.Events: one share.* envelope. A refusal only loses the event copy, never the setting. */
    async function publish(envelope) {
        if (!config.events || !config.events.url) { log.warn('[Sharing] no events URL configured; share envelope not sent'); return; }
        const res = await fetchImpl(String(config.events.url).replace(/\/+$/, ''), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(envelope),
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error('Events answered ' + res.status);
    }

    /**
     * The old visibility column follows the audience, so a reader that only knows `tours_trips.visibility` fails
     * closed: Everyone and link stay readable by whoever holds the slug, Specific people and Only me do not.
     */
    async function onAudienceChange(ref, audience, tx) {
        if (ref.service !== SERVICE || ref.kind !== KIND) return;
        await tx.exec('UPDATE tours_trips SET visibility = $1, updated_at = now() WHERE slug = $2',
            [VISIBILITY[audience] || 'private', String(ref.id)]);
    }

    async function onOwnerChange(ref, from, to, tx) {
        if (ref.service !== SERVICE || ref.kind !== KIND) return;
        const owner = to && to.type === 'user' ? to.id : null;
        if (!owner) return;
        await tx.exec('UPDATE tours_trips SET owner_subject = $1, updated_at = now() WHERE slug = $2', [owner, String(ref.id)]);
    }

    const shares = createShares({
        db,
        network: { json: networkJson },
        events: { publish },
        notify,
        onAudienceChange,
        onOwnerChange,
    });

    return {
        shares,
        SERVICE,
        KIND,
        AUDIENCES,
        DEFAULT_AUDIENCE,
        refOf,
        shareViewer,
        networkJson,
        /** Register a trip, at the owner's default until the Share sheet says otherwise. */
        register: async (viewer, slug, audience = DEFAULT_AUDIENCE) => await shares.register(refOf(slug), {
            owner_subject: { type: 'user', id: String(viewer.subject) },
            audience: AUDIENCES.includes(audience) ? audience : DEFAULT_AUDIENCE,
        }),
        canView: async (viewer, slug) => await shares.canView(shareViewer(viewer), refOf(slug)),
        canEdit: async (viewer, slug) => await shares.canEdit(shareViewer(viewer), refOf(slug)),
        setAudience: async (viewer, slug, audience) => await shares.setAudience(shareViewer(viewer), refOf(slug), audience),
        /** The share row, or null for a trip that predates the backfill (its old column decides). */
        shareOf: async (slug) => await db.maybe('SELECT * FROM shares WHERE service = $1 AND kind = $2 AND resource_id = $3',
            [SERVICE, KIND, String(slug)]),
        /** Just the audience, for deciding between "Only me" (no hint) and "Specific people" (the gate). */
        audienceOf: async (slug) => {
            const row = await db.maybe('SELECT audience FROM shares WHERE service = $1 AND kind = $2 AND resource_id = $3',
                [SERVICE, KIND, String(slug)]);
            return row ? row.audience : null;
        },
        defaultOf: async (subject) => {
            if (!subject) return DEFAULT_AUDIENCE;
            const row = await db.maybe('SELECT audience FROM tours_share_defaults WHERE subject = $1', [String(subject)]);
            return row && AUDIENCES.includes(row.audience) ? row.audience : DEFAULT_AUDIENCE;
        },
        /** Set the default, and with `applyAll` move the person's existing trips too (design rule 2). */
        setDefault: async (subject, audience, { applyAll = false } = {}) => {
            if (!subject) return false;
            const want = AUDIENCES.includes(audience) ? audience : DEFAULT_AUDIENCE;
            await db.exec(`INSERT INTO tours_share_defaults (subject, audience, updated_at) VALUES ($1, $2, now())
                ON CONFLICT (subject) DO UPDATE SET audience = excluded.audience, updated_at = now()`, [String(subject), want]);
            if (applyAll) {
                await db.exec(`UPDATE shares SET audience = $1, revision = revision + 1
                    WHERE service = $2 AND kind = $3 AND owner_subject->>'id' = $4 AND owner_subject->>'type' = 'user'`,
                    [want, SERVICE, KIND, String(subject)]);
            }
            return true;
        },
        /** The uniform API's describe(ref): the trip's title and its page. */
        describe: async (ref) => {
            if (ref.service !== SERVICE || ref.kind !== KIND) return {};
            const row = await db.maybe('SELECT slug, title FROM tours_trips WHERE slug = $1', [String(ref.id)]);
            if (!row) return {};
            return {
                title: String(row.title || 'A trip').slice(0, 120),
                link: `${config.baseUrl}/trips/${encodeURIComponent(row.slug)}`,
                roles: ['viewer', 'editor'],
                transferable: false,
            };
        },
        /** Expire members and transfers, then send the queued events and notifications. */
        work: async ({ flush = true } = {}) => {
            let expired = 0;
            try { expired = await shares.expireMembers(); } catch (err) { log.warn('[Sharing] expiry sweep:', err.message); }
            let sent = 0;
            if (flush) { try { sent = await shares.flush(); } catch (err) { log.warn('[Sharing] deliveries:', err.message); } }
            return { expired, sent };
        },
    };
}

module.exports = { createSharing, shareViewer, refOf, AUDIENCES, DEFAULT_AUDIENCE, VISIBILITY, SERVICE, KIND };
