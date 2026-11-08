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
const { isPlace } = require('../places/is-place');

// Commercial pages use only licences that permit reuse and derivatives. A Commons record without
// both an author and a source is no better than an unlicensed hotlink.
function reusableImage({ license, credit, url, sourceUrl }) {
    return Boolean(url && sourceUrl && credit && license && /^(?:CC0|CC BY(?:-SA)?(?:\s|$)|Public Domain|PDM)/i.test(license)
        && !/\b(?:NC|ND)\b/i.test(license));
}

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
    const commonsCategory = firstClaim(entity, 'P373');
    const country = firstClaim(entity, 'P17');
    const label = (entity.labels && entity.labels.en && entity.labels.en.value) || null;
    const sitelink = entity.sitelinks && entity.sitelinks.enwikivoyage && entity.sitelinks.enwikivoyage.title;
    const wikipediaTitle = entity.sitelinks && entity.sitelinks.enwiki && entity.sitelinks.enwiki.title;
    return {
        qid: entity.id,
        label,
        lat: coord && Number.isFinite(Number(coord.latitude)) ? Number(coord.latitude) : null,
        lon: coord && Number.isFinite(Number(coord.longitude)) ? Number(coord.longitude) : null,
        population: pop && Number.isFinite(Number(String(pop.amount || '').replace(/^\+/, ''))) ? Number(String(pop.amount).replace(/^\+/, '')) : null,
        image: image ? String(image) : null,
        commonsCategory: typeof commonsCategory === 'string' ? `Category:${commonsCategory}` : null,
        countryQid: country && typeof country === 'object' && country.id ? country.id : null,
        wikivoyageTitle: sitelink || null,
        wikipediaTitle: wikipediaTitle || null,
        sitelinks: Object.keys(entity.sitelinks || {}).length,
    };
}

function extractGuide(extract, title) {
    const text = String(extract || '').replace(/\r/g, '').trim();
    const lead = text.split(/\n\s*==/)[0].trim();
    const sentences = lead.match(/[^.!?]+[.!?]+(?:\s|$)/g)?.map((s) => s.trim()) || [];
    const intro = sentences[0] || '';
    if (!intro || intro.length < 20) return null;
    const why = sentences.slice(1, 4).join(' ').slice(0, 600) || null;
    const section = (name) => text.match(new RegExp(`== ${name} ==\\n([\\s\\S]*?)(?=\\n== |$)`, 'i'))?.[1] || '';
    const features = section('Features and programs').match(/Major features[^.]*\./i)?.[0] || null;
    const visit = text.match(/[^.\n]*(?:public tour|guided tour|free tour)[^.\n]*\./i)?.[0]?.trim() || null;
    // An unrelated plant's biology is not advice about when to visit this destination.
    const named = String(title || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const seasonal = /\b(?:spring|summer|fall|autumn|winter|bloom(?:ing|s)?|foliage|season(?:al|s)?|January|February|March|April|May|June|July|August|September|October|November|December)\b/i;
    const season = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim())
        .find((s) => seasonal.test(s) && new RegExp(`\\b${named}\\b`, 'i').test(s)) || null;
    return { intro: intro.slice(0, 600), why, features: features?.slice(0, 400) || null,
        visit: visit?.slice(0, 400) || null, season: season?.slice(0, 400) || null,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}` };
}

function createWikidata({ config, fetchImpl, pace, log = console }) {
    const opts = { fetchImpl, pace, timeoutMs: config.upstreams.timeoutMs, userAgent: config.openData.userAgent, label: 'Wikidata' };

    async function notablePlaces(cityQid) {
        if (!/^Q[1-9][0-9]{0,11}$/.test(String(cityQid || ''))) return [];
        // WDQS times out joining P131+ to P279* on a large city. Its P31 English labels are bounded after the
        // administrative-chain match; two rows for one item are collapsed below before the top 60 are kept.
        const query = `SELECT DISTINCT ?item ?label ?coordinate ?links ?instanceLabel WHERE {
          ?item wdt:P131+ wd:${cityQid}; wdt:P625 ?coordinate; wdt:P31 ?kind; wikibase:sitelinks ?links; rdfs:label ?label.
          ?kind rdfs:label ?instanceLabel.
          FILTER(LANG(?label) = "en" && LANG(?instanceLabel) = "en" &&
            REGEX(?instanceLabel, "museum|park|garden|landmark|viewpoint|zoo|aquarium|observation tower|monument|tourist attraction|art gallery|historic site", "i"))
        } ORDER BY DESC(?links) LIMIT 120`;
        const url = `${config.upstreams.wikidataQuery}?${new URLSearchParams({ query, format: 'json' })}`;
        const { json, fetchedAt } = await fetchJson(url, { ...opts, label: 'Wikidata Query Service', retries: 0 });
        const seen = new Set();
        return (json?.results?.bindings || []).map((b) => {
            const qid = String(b.item?.value || '').match(/\/Q[1-9][0-9]{0,11}$/)?.[0]?.slice(1);
            const coord = String(b.coordinate?.value || '').match(/^Point\((-?[\d.]+) (-?[\d.]+)\)$/);
            const name = b.label?.value || '';
            if (!qid || seen.has(qid) || !coord || !isPlace(name, { instanceLabel: b.instanceLabel?.value })) return null;
            seen.add(qid);
            return { qid, name, lon: Number(coord[1]), lat: Number(coord[2]), sitelinks: Number(b.links?.value || b.sitelinks?.value || 0),
                sourceUrl: `https://www.wikidata.org/wiki/${qid}`, fetchedAt };
        }).filter(Boolean).slice(0, 60);
    }

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

    async function article(title) {
        const name = String(title || '').trim();
        if (!name || name.length > 120) return null;
        const url = `${config.upstreams.wikipedia}/w/api.php?${new URLSearchParams({
            action: 'query', format: 'json', formatversion: '2', prop: 'extracts', explaintext: '1', titles: name,
        })}`;
        const { json } = await fetchJson(url, { ...opts, label: 'Wikipedia' });
        const page = json?.query?.pages?.[0];
        return page && !page.missing ? extractGuide(page.extract, page.title || name) : null;
    }

    /** Q ids → parsed entities (all props the city job needs). */
    async function entities(qids) {
        const wanted = [...new Set((qids || []).filter((q) => /^Q[1-9][0-9]{0,11}$/.test(String(q))))];
        const out = new Map();
        for (const group of chunk(wanted, 40)) {
            const url = `${config.upstreams.wikidata}/w/api.php?${new URLSearchParams({
                action: 'wbgetentities', format: 'json', ids: group.join('|'), props: 'claims|labels|sitelinks',
                languages: 'en',
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
                // Commons' Artist is HTML: a tag becomes a space, then the space before punctuation and a trailing full
                // stop go ("Ramir Borja</a>." read "Ramir Borja ." beside the licence, 2026-11-02).
                const ENT = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
                const strip = (s) => (s ? s.replace(/<[^>]*>/g, ' ').replace(/&(amp|quot|#39|lt|gt|nbsp);/g, (e) => ENT[e]).replace(/\s+/g, ' ')
                    .replace(/\s+([.,;:!?])/g, '$1').replace(/[\s.]+$/, '').trim() || null : null);
                const image = {
                    url: info.thumburl || info.url || null,
                    credit: strip(val('Artist')) || strip(val('Credit')),
                    license: strip(val('LicenseShortName')),
                    licenseUrl: val('LicenseUrl'),
                    sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title).replace(/ /g, '_'))}`,
                };
                if (reusableImage(image)) out.set(String(page.title), image);
            }
        }
        return out;
    }

    async function categoryFiles(category) {
        const name = String(category || '').trim();
        if (!/^Category:[^|#?]{3,120}$/i.test(name)) return [];
        const url = `${config.upstreams.commons}/w/api.php?${new URLSearchParams({
            action: 'query', format: 'json', formatversion: '2', list: 'categorymembers',
            cmtitle: name, cmtype: 'file', cmlimit: '5',
        })}`;
        const { json } = await fetchJson(url, { ...opts, label: 'Commons category' });
        return ((json && json.query && json.query.categorymembers) || []).map((r) => r.title).filter((t) => /^File:/i.test(t));
    }

    return { resolveQids, entities, countryInfo, imageInfo, categoryFiles, article, notablePlaces, parseEntity };
}

module.exports = { createWikidata, parseEntity, extractGuide, claimValues, firstClaim, chunk, SourceError, reusableImage };
