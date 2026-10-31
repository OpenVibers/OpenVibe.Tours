'use strict';

/** Wikivoyage's MediaWiki API: one page's wikitext, or null when the page does not exist. */
const { fetchJson } = require('./http');
const { pageUrl } = require('./wikivoyage');

function createWikivoyage({ config, fetchImpl, pace }) {
    const opts = { fetchImpl, pace, timeoutMs: config.upstreams.timeoutMs, userAgent: config.openData.userAgent, label: 'Wikivoyage' };

    async function page(title) {
        const name = String(title || '').trim();
        if (!name) return null;
        const url = `${config.upstreams.wikivoyage}/w/api.php?${new URLSearchParams({
            action: 'parse', page: name, prop: 'wikitext', format: 'json', formatversion: '2', redirects: '1',
        })}`;
        const { json, fetchedAt } = await fetchJson(url, opts);
        if (!json || !json.parse || typeof json.parse.wikitext !== 'string') return null;
        return {
            title: json.parse.title || name,
            wikitext: json.parse.wikitext,
            revision: json.parse.revid || null,
            sourceUrl: pageUrl(json.parse.title || name),
            fetchedAt,
        };
    }

    /** Search for a page when the catalogue's title is not the Wikivoyage one. */
    async function search(title) {
        const url = `${config.upstreams.wikivoyage}/w/api.php?${new URLSearchParams({
            action: 'query', list: 'search', srsearch: String(title || ''), srlimit: '1', format: 'json', formatversion: '2',
        })}`;
        const { json } = await fetchJson(url, { ...opts, label: 'Wikivoyage search' });
        const hit = json && json.query && json.query.search && json.query.search[0];
        return hit ? hit.title : null;
    }

    return { page, search };
}

module.exports = { createWikivoyage };
