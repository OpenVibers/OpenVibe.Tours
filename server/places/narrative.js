'use strict';
const { clipSentences } = require('./clip');

const crypto = require('crypto');

function createNarrative({ config, s, fetchImpl = globalThis.fetch, log = console }) {
    let ai = null;
    if (config.ai.url && config.oauth.clientSecret && !config.drill) {
        const { serviceAuth } = require('openvibe-contracts');
        const { createAiClient } = require('openvibe-publishing/ai');
        const tokenClient = serviceAuth.createTokenClient({
            tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: config.oauth.clientId,
            clientSecret: config.oauth.clientSecret, audience: 'openvibe.ai', scope: config.ai.scope, fetchImpl,
        });
        ai = createAiClient({ baseUrl: config.ai.url, tokenClient, fetch: fetchImpl, waitMs: 4000, timeoutMs: 6000, pollMs: 500 });
    }

    async function forPlace(place) {
        if (!place?.description || !place.source_url) return null;
        const old = await s.db.maybe('SELECT summary, run_id FROM tours_place_summaries WHERE place_id=$1 AND source_fetched_at=$2::timestamptz', [place.id, place.fetched_at]);
        if (old) return { text: old.summary, runId: old.run_id, sourceUrl: place.source_url };
        if (!ai?.enabled) return null;
        try {
            const key = crypto.createHash('sha256').update(`${place.id}:${place.fetched_at}:${place.description}`).digest('hex');
            const r = await ai.run('ai.summarize', {
                text: `${place.name}: ${place.description}`, max_words: 70, style: 'a short, inviting visitor guide using only the source facts',
            }, { target: { service: 'tours', type: 'place', id: place.id }, idempotencyKey: `tours-place-${key}` });
            const summary = clipSentences(r.output?.text || '', 800);
            if (!summary || r.synthetic) return null;
            await s.db.exec(`INSERT INTO tours_place_summaries(place_id, source_fetched_at, summary, run_id)
                VALUES ($1,$2::timestamptz,$3,$4) ON CONFLICT(place_id) DO UPDATE SET
                source_fetched_at=EXCLUDED.source_fetched_at, summary=EXCLUDED.summary, run_id=EXCLUDED.run_id, updated_at=now()`,
            [place.id, place.fetched_at, summary, r.runId]);
            return { text: summary, runId: r.runId, sourceUrl: place.source_url };
        } catch (err) { log.warn(`[Tours narrative] ${place.id}: ${err.message}`); return null; }
    }
    return { forPlace };
}

module.exports = { createNarrative };
