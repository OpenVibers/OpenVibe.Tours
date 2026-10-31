'use strict';

/**
 * Wikidata, Wikipedia and Wikimedia Commons (CC0 / CC BY-SA; each image keeps its own licence).
 *
 *   resolveQids(titles)   Wikipedia page title → Wikidata Q id, through pageprops (redirects followed)
 *   entities(qids)        coordinates (P625), population (P1082), image (P18), country (P17), the English
 *                         Wikivoyage sitelink and the English label
 *   countryInfo(qids)     a country's label and ISO 3166-1 alpha-2 (P297)
 *   imageInfo(files)      a Commons file's 1200px URL and its licence/credit (extmetadata)
 */
const { fetchJson, SourceError } = require('./http');

const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

function claimValues(entity, prop) {
    const claims = entity && entity.claims && entity.claims[prop];
    if (!Array.isArray(claims)) return [];
    return claims.map((c) => c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value).filter(Boolean);
}

function firstClaim(entity, prop) {
    return claimValues(entity, prop)[0] || null;
}

function parseEntity(entity) {
    if (!entity || !entity.id) return null;
    const coord = firstClaim(entity, 'P625');
    const pop = firstClaim(entity, 'P1082');
    const image = firstClaim(entity, 'P18');
    const country = firstClaim(entity, 'P17');
    const label = (entity.labels && entity.labels.en && entity.labels.en.value) || null;
    const sitelink = entity.sitelinks && entity.sitelinks.enwikivoyage && entity.sitelinks.enwikivoyage.title;
    return {
        qid: entity.id,
        label,
        lat: coord && Number.isFinite(Number(coord.latitude)) ? Number(coord.latitude) : null,
        lon: coord && Number.isFinite(Number(coord.longitude)) ? Number(coord.longitude) : null,
        population: pop && Number.isFinite(Number(String(pop.amount || '').replace(/^\+/, ''))) ? Number(String(pop.amount).replace(/^\+/, '')) : null,
        image: image ? String(image) : null,
        countryQid: country && typeof country === 'object' && country.id ? country.id : null,
        wikivoyageTitle: sitelink || null,
    };
}

function createWikidata({ config, fetchImpl, pace, log = console }) {
    const opts = { fetchImpl, pace, timeoutMs: config.upstreams.timeoutMs, userAgent: config.openData.userAgent, label: 'Wikidata' };

    /** Wikipedia titles → Q ids. Returns a Map keyed by the requested title (redirects resolved). */
    async function resolveQids(titles) {
        const wanted = [...new Set((titles || []).map((t) => String(t || '').trim()).filter(Boolean))];
        const out = new Map();
        for (const group of chunk(wanted, 40)) {
            const url = `${config.upstreams.wikipedia}/w/api.php?${new URLSearchParams({
                action: 'query', format: 'json', formatversion: '2', redirects: '1',
                prop: 'pageprops', ppprop: 'wikibase_item', titles: group.join('|'),
            })}`;
            const { json, fetchedAt } = await fetchJson(url, { ...opts, label: 'Wikipedia' });
            const pages = (json && json.query && json.query.pages) || [];
            const redirects = (json && json.query && json.query.redirects) || [];
            const redirectTo = new Map(redirects.map((r) => [String(r.from), String(r.to)]));
            const byTitle = new Map(pages.map((p) => [String(p.title), p]));
            for (const title of group) {
                const landed = redirectTo.get(title) || title;
                const page = byTitle.get(landed) || byTitle.get(title);
                const qid = page && page.pageprops && page.pageprops.wikibase_item;
                if (qid && /^Q[1-9][0-9]{0,11}$/.test(qid)) out.set(title, { qid, title: page.title, fetchedAt });
            }
        }
        return out;
    }

    /** Q ids → parsed entities (all props the city job needs). */
    async function entities(qids) {
        const wanted = [...new Set((qids || []).filter((q) => /^Q[1-9][0-9]{0,11}$/.test(String(q))))];
        const out = new Map();
        for (const group of chunk(wanted, 40)) {
            const url = `${config.upstreams.wikidata}/w/api.php?${new URLSearchParams({
                action: 'wbgetentities', format: 'json', ids: group.join('|'), props: 'claims|labels|sitelinks',
                languages: 'en', sitefilter: 'enwikivoyage',
            })}`;
            const { json, fetchedAt } = await fetchJson(url, { ...opts, label: 'Wikidata' });
            const entitiesObj = (json && json.entities) || {};
            for (const qid of group) {
                const parsed = parseEntity(entitiesObj[qid]);
                if (parsed) out.set(qid, { ...parsed, fetchedAt });
            }
        }
        return out;
    }

    /** Country Q ids → { label, code } (ISO 3166-1 alpha-2 from P297). */
    async function countryInfo(qids) {
        const wanted = [...new Set((qids || []).filter(Boolean))];
        const out = new Map();
        for (const group of chunk(wanted, 40)) {
            const url = `${config.upstreams.wikidata}/w/api.php?${new URLSearchParams({
                action: 'wbgetentities', format: 'json', ids: group.join('|'), props: 'claims|labels', languages: 'en',
            })}`;
            const { json } = await fetchJson(url, { ...opts, label: 'Wikidata' });
            const entitiesObj = (json && json.entities) || {};
            for (const qid of group) {
                const e = entitiesObj[qid];
                if (!e) continue;
                const code = firstClaim(e, 'P297');
                out.set(qid, {
                    label: (e.labels && e.labels.en && e.labels.en.value) || null,
                    code: typeof code === 'string' ? code : (code && code.id) || null,
                });
            }
        }
        return out;
    }

    /** Commons file titles (`File:X.jpg`) → { url, credit, license, licenseUrl }. */
    async function imageInfo(files) {
        const wanted = [...new Set((files || []).filter(Boolean))];
        const out = new Map();
        for (const group of chunk(wanted, 40)) {
            const url = `${config.upstreams.commons}/w/api.php?${new URLSearchParams({
                action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo',
                iiprop: 'extmetadata|url', iiurlwidth: '1200', titles: group.join('|'),
            })}`;
            let json;
            try { ({ json } = await fetchJson(url, { ...opts, label: 'Commons' })); } catch (err) {
                log.warn(`[OpenVibe.Tours] Commons image metadata: ${err && err.message}`);
                continue;
            }
            const pages = (json && json.query && json.query.pages) || [];
            for (const page of pages) {
                const info = page.imageinfo && page.imageinfo[0];
                if (!info) continue;
                const meta = info.extmetadata || {};
                const val = (k) => (meta[k] && meta[k].value ? String(meta[k].value) : null);
                const strip = (s) => (s ? s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null);
                out.set(String(page.title), {
                    url: info.thumburl || info.url || null,
                    credit: strip(val('Artist')) || strip(val('Credit')) || 'Wikimedia Commons',
                    license: strip(val('LicenseShortName')),
                    licenseUrl: val('LicenseUrl'),
                });
            }
        }
        return out;
    }

    return { resolveQids, entities, countryInfo, imageInfo, parseEntity };
}

module.exports = { createWikidata, parseEntity, claimValues, firstClaim, chunk, SourceError };
