'use strict';

/**
 * OpenVibe.Live's public stream list and recent VODs. Live has no location field: a stream is an IRL tour when its
 * public category is irl/outdoors/travel, its tags say irl, or its title plainly is one (a walk, a tour, a market).
 * The job then matches a known Tour city by name in the title or tags, which is the only "location" Live publishes.
 */
const { fetchJson } = require('./http');

const IRL_CATEGORIES = new Set(['irl', 'outdoors', 'travel', 'walking']);
const IRL_WORDS = /\b(irl|walk(?:ing)?|tour|city walk|hike|hiking|travel|explore|market|street|neighbou?rhood|sightseeing)\b/i;

function parseTags(value) {
    if (Array.isArray(value)) return value.map(String);
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch { return String(value || '').split(',').map((s) => s.trim()).filter(Boolean); }
}

function utc(value) {
    if (!value) return null;
    const s = String(value).trim();
    const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function categoryOf(s) {
    return String(s.category || s.chosen_category || '').toLowerCase();
}

function isIrl(s) {
    if (IRL_CATEGORIES.has(categoryOf(s))) return true;
    const tags = parseTags(s.tags).map((t) => t.toLowerCase());
    if (tags.includes('irl') || tags.includes('travel')) return true;
    return IRL_WORDS.test(String(s.title || ''));
}

function streamOf(s, { fetchedAt, liveUrl, videoBase }) {
    const username = String(s.username || '').slice(0, 64);
    if (!username) return null;
    const category = categoryOf(s) || 'irl';
    return {
        kind: 'stream',
        externalId: String(s.id),
        username,
        displayName: s.display_name || username,
        title: String(s.title || `${username} is live`).slice(0, 240),
        category,
        thumbnailUrl: /^https:\/\//i.test(s.thumbnail_url || '') ? s.thumbnail_url : null,
        viewerCount: Math.max(0, Number(s.viewer_count || s.total_viewer_count || 0) || 0),
        url: `${liveUrl}/@${encodeURIComponent(username)}`,
        startedAt: utc(s.started_at),
        endedAt: utc(s.ended_at),
        fetchedAt,
        tags: parseTags(s.tags),
        videoBase,
    };
}

function vodOf(s, { fetchedAt, liveUrl, videoBase }) {
    const base = streamOf(s, { fetchedAt, liveUrl, videoBase });
    if (!base) return null;
    const vodId = Number(s.vod_id);
    return {
        ...base,
        kind: 'vod',
        externalId: `vod-${vodId || s.id}`,
        url: Number.isSafeInteger(vodId) && vodId > 0 ? `${videoBase}/v/${vodId}` : base.url,
        thumbnailUrl: /^https:\/\//i.test(s.vod_thumbnail_url || '') ? s.vod_thumbnail_url : base.thumbnailUrl,
        endedAt: base.endedAt || base.startedAt,
    };
}

function clipOf(c, { fetchedAt, videoBase }) {
    const username = String(c.username || c.streamer_username || '').slice(0, 64);
    const id = Number(c.id);
    if (!username || !Number.isSafeInteger(id) || id <= 0) return null;
    return {
        kind: 'clip',
        externalId: `clip-${id}`,
        username,
        displayName: c.display_name || c.streamer_display_name || username,
        title: String(c.title || 'A clip').slice(0, 240),
        category: 'clip',
        thumbnailUrl: /^https:\/\//i.test(c.thumbnail_url || '') ? c.thumbnail_url : null,
        viewerCount: Math.max(0, Number(c.view_count || 0) || 0),
        url: `${videoBase}/c/${id}`,
        startedAt: utc(c.created_at),
        endedAt: utc(c.created_at),
        fetchedAt,
        tags: [],
    };
}

function createLive({ config, fetchImpl, pace }) {
    const opts = { fetchImpl, pace, timeoutMs: config.upstreams.timeoutMs, userAgent: config.openData.userAgent, label: 'OpenVibe.Live' };
    const liveUrl = config.upstreams.livePublic || 'https://openvibe.live';
    const videoBase = config.upstreams.video || 'https://openvibe.video';

    async function streams() {
        const { json, fetchedAt } = await fetchJson(`${config.upstreams.live}/api/streams`, opts);
        const list = (json && json.streams) || [];
        const seen = new Set();
        const out = [];
        for (const s of list) {
            if (s && s.id != null) { if (seen.has(s.id)) continue; seen.add(s.id); }
            const row = streamOf(s, { fetchedAt, liveUrl, videoBase });
            if (row && isIrl(s)) out.push(row);
        }
        return { streams: out, fetchedAt };
    }

    async function recent(limit = 50) {
        const { json, fetchedAt } = await fetchJson(`${config.upstreams.live}/api/streams/recent?limit=${Math.min(100, Math.max(1, Number(limit) || 50))}`, opts);
        const list = (json && json.streams) || [];
        const seen = new Set();
        const out = [];
        for (const s of list) {
            if (s && s.id != null) { if (seen.has(s.id)) continue; seen.add(s.id); }
            const row = vodOf(s, { fetchedAt, liveUrl, videoBase });
            if (row && isIrl(s)) out.push(row);
        }
        return { streams: out, fetchedAt };
    }

    /** Recent public clips; the IRL test is the title (a clip has no category of its own). */
    async function clips(limit = 50) {
        const { json, fetchedAt } = await fetchJson(`${config.upstreams.live}/api/clips?limit=${Math.min(100, Math.max(1, Number(limit) || 50))}`, opts);
        const list = (json && json.clips) || [];
        const seen = new Set();
        const out = [];
        for (const c of list) {
            if (c && c.id != null) { if (seen.has(c.id)) continue; seen.add(c.id); }
            const row = clipOf(c, { fetchedAt, videoBase });
            if (row && isIrl(c)) out.push(row);
        }
        return { clips: out, fetchedAt };
    }

    return { streams, recent, clips, isIrl, parseTags, categoryOf };
}

module.exports = { createLive, isIrl, streamOf, vodOf, clipOf, parseTags, utc, IRL_CATEGORIES };
