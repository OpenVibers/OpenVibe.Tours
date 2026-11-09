'use strict';
const { clipSentences } = require('../places/clip');

/**
 * Wikivoyage parsing (CC BY-SA). A city page gives the lead summary and its "See" listings; a districted city keeps
 * the listings on district pages, so the city page's See section links the ones to fetch. Every route stop built
 * from these keeps the Wikivoyage page URL it came from.
 *
 * This module is pure: no network, no database. The job decides what to fetch.
 */

/** The outside of a balanced {{…}} template, or a single balanced template's inside at index i. */
function matchingBrace(text, start) {
    let depth = 0;
    for (let i = start; i < text.length - 1; i += 1) {
        if (text[i] === '{' && text[i + 1] === '{') { depth += 1; i += 1; continue; }
        if (text[i] === '}' && text[i + 1] === '}') {
            depth -= 1;
            i += 1;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}

// Inline templates that carry the sentence's words are kept as their text; every other template goes. Removing
// {{convert|82400|km2}} left Chongqing's lead "…and covers ." (production, 2026-11-02).
const UNITS = { km2: 'km²', 'km²': 'km²', sqkm: 'km²', sqmi: 'sq mi', mi2: 'sq mi', km: 'km', mi: 'mi', m: 'm', ft: 'ft', ha: 'ha',
    acre: 'acres', acres: 'acres', c: '°C', f: '°F', '°c': '°C', '°f': '°F', kg: 'kg', lb: 'lb', 'km/h': 'km/h', mph: 'mph', l: 'L' };
const UNIT_TEMPLATES = { km: 'km', km2: 'km²', m: 'm', m2: 'm²', mi: 'mi', mi2: 'sq mi', sqmi: 'sq mi', ft: 'ft', ft2: 'sq ft', kg: 'kg', lb: 'lb', ha: 'ha', acre: 'acres', kmh: 'km/h', mph: 'mph' };
const number = (v) => (/^-?\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v).trim());
function inlineTemplate(inner) {
    const parts = splitParams(inner).map((x) => x.trim());
    const name = String(parts[0] || '').toLowerCase().replace(/_/g, ' ').trim();
    const pos = parts.slice(1).filter((x) => !/^[a-z_ -]+=/i.test(x));
    const named = paramsOf(inner);
    if (name === 'convert' || name === 'cvt') {
        if (!pos[0]) return '';
        // {{convert|20|-|25|km}}, {{convert|5|to|10|mi}}: a range
        if (['-', '–', 'to', 'and'].includes(String(pos[1]).toLowerCase()) && pos[2]) {
            const unit = UNITS[String(pos[3] || '').toLowerCase()] || pos[3] || '';
            return `${number(pos[0])}${pos[1] === 'to' || pos[1] === 'and' ? ` ${pos[1]} ` : '–'}${number(pos[2])}${unit ? ` ${unit}` : ''}`;
        }
        const unit = UNITS[String(pos[1] || '').toLowerCase()] || pos[1] || '';
        return `${number(pos[0])}${unit ? ` ${unit}` : ''}`;
    }
    // Wikivoyage's unit templates: {{km2|82,403}} is "82,403 km²" ("…and covers ." for Chongqing, 2026-11-02), {{m|28}}
    // is "28 m".
    if (UNIT_TEMPLATES[name] && pos[0]) return `${number(pos[0])} ${UNIT_TEMPLATES[name]}`;
    if (name === 'unesco') return 'UNESCO World Heritage Site';
    // A rail line's badge ({{rint|losangeles|b}}): its letter or number, as the badge reads.
    if ((name === 'rint' || name === 'rail-interchange') && pos[1]) return String(pos[1]).toUpperCase();
    if (name === 'lang' || name === 'lang-zh') return pos[pos.length - 1] || '';
    if (name === 'nowrap' || name === 'nobr' || name === 'small' || name === 'iata' || name === 'icao') return pos[0] || '';
    if (name === 'w' || name === 'wp') return pos[1] || pos[0] || '';
    if (name === 'marker') return named.name || '';
    return null;
}

function removeTemplates(text) {
    let out = '';
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '{' && text[i + 1] === '{') {
            const end = matchingBrace(text, i);
            if (end > 0) {
                const kept = inlineTemplate(text.slice(i + 2, end - 2));
                if (kept) out += removeTemplates(kept);
                i = end - 1;
                continue;
            }
        }
        out += text[i];
    }
    return out;
}

function removeFiles(text) {
    let out = '';
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '[' && text[i + 1] === '[') {
            const close = text.indexOf(']]', i + 2);
            if (close > 0) {
                const inner = text.slice(i + 2, close);
                if (/^(file|image)\s*:/i.test(inner)) { i = close + 1; continue; }
            }
        }
        out += text[i];
    }
    return out;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—' };

/** Wikitext → plain text: templates and files out, links to their label, markup off. */
function stripWiki(value, { max = 1200 } = {}) {
    let s = String(value == null ? '' : value);
    s = s.replace(/<!--[\s\S]*?-->/g, ' ');
    s = s.replace(/<ref[^>]*\/>/gi, ' ').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ');
    s = removeTemplates(s);
    s = removeFiles(s);
    s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
    s = s.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1').replace(/\[https?:\/\/[^\s\]]+\]/g, ' ');
    s = s.replace(/'''?/g, '');
    s = s.replace(/<\/?[a-z][^>]*>/gi, ' ');
    s = s.replace(/\{\{|\}\}/g, ' ');
    for (const [k, v] of Object.entries(ENTITIES)) s = s.split(k).join(v);
    s = s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ');
    // A space a removed template left before punctuation, and an empty bracket pair.
    s = s.replace(/\(\s*\)/g, '').replace(/\s+([.,;:!?])/g, '$1').replace(/[ ]{2,}/g, ' ').trim();
    return s.slice(0, max);
}

/** The lead: the first real paragraph after the pagebanner/templates, at most 1000 characters. */
function leadSummary(wikitext) {
    const text = String(wikitext || '');
    const clean = removeFiles(removeTemplates(text.replace(/<!--[\s\S]*?-->/g, ' ')));
    const blocks = clean.split(/\n\s*\n/);
    for (const block of blocks) {
        const line = block.trim();
        if (!line || line.startsWith('|') || line.startsWith('=') || line.startsWith('*') || line.startsWith('#')) continue;
        const plain = stripWiki(line, { max: 1400 });
        if (plain.length >= 80) return clipSentences(plain, 1000);
    }
    return '';
}

/** Split a template body on top-level pipes (nested [[…]] and {{…}} stay whole). */
function splitParams(body) {
    const parts = [];
    let depthBrace = 0;
    let depthLink = 0;
    let cur = '';
    for (let i = 0; i < body.length; i += 1) {
        const two = body.slice(i, i + 2);
        if (two === '{{') { depthBrace += 1; cur += two; i += 1; continue; }
        if (two === '}}') { depthBrace = Math.max(0, depthBrace - 1); cur += two; i += 1; continue; }
        if (two === '[[') { depthLink += 1; cur += two; i += 1; continue; }
        if (two === ']]') { depthLink = Math.max(0, depthLink - 1); cur += two; i += 1; continue; }
        if (body[i] === '|' && depthBrace === 0 && depthLink === 0) { parts.push(cur); cur = ''; continue; }
        cur += body[i];
    }
    parts.push(cur);
    return parts;
}

function paramsOf(body) {
    const out = {};
    for (const part of splitParams(body)) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const key = part.slice(0, eq).trim().toLowerCase();
        if (!key || /[\s]/.test(key)) continue;
        out[key] = part.slice(eq + 1).trim();
    }
    return out;
}

function coordFrom(params) {
    for (const [latKey, lonKey] of [['lat', 'long'], ['lat', 'lon'], ['latitude', 'longitude']]) {
        const lat = Number(params[latKey]);
        const lon = Number(params[lonKey]);
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
    }
    const c = String(params.coordinates || params.coord || '');
    const m = c.match(/(-?\d{1,3}(?:\.\d+)?)\s*[,;|]\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (m) {
        const lat = Number(m[1]); const lon = Number(m[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
    }
    return null;
}

/** Every {{see}} (and old {{listing|type=see}}) on a page, with coordinates when the listing has them. */
function seeListings(wikitext, types = ['see']) {
    const text = String(wikitext || '');
    const out = [];
    const titles = new Set();
    for (let i = 0; i < text.length - 1; i += 1) {
        if (!(text[i] === '{' && text[i + 1] === '{')) continue;
        const end = matchingBrace(text, i);
        if (end < 0) break;
        const body = text.slice(i + 2, end - 2);
        const head = (body.split('|')[0] || '').trim().toLowerCase().replace(/^subst:/, '');
        const isSee = types.includes(head);
        const isListing = head === 'listing' && types.some((type) => new RegExp(`(?:^|\\|)\\s*type\\s*=\\s*${type}\\b`, 'i').test(body));
        if (!isSee && !isListing) { i = end - 1; continue; }
        const p = paramsOf(body);
        const name = stripWiki(p.name || p.title || '', { max: 200 });
        const coord = coordFrom(p);
        const key = `${name.toLowerCase()}|${coord ? `${coord.lat},${coord.lon}` : 'nocoord'}`;
        if (name && !titles.has(key)) {
            titles.add(key);
            out.push({
                name,
                lat: coord ? coord.lat : null,
                lon: coord ? coord.lon : null,
                note: stripWiki(p.content || p.description || p.address || '', { max: 600 }),
                wikidata: String(p.wikidata || '').trim() || null,
                url: String(p.url || '').trim() || null,
                hasCoords: Boolean(coord),
            });
        }
        i = end - 1;
    }
    return out;
}

/** District or subpage links on a city page (`[[Lisbon/Alfama|Alfama]]`), in page order. */
function districtLinks(wikitext, cityTitle, limit = 2) {
    const text = String(wikitext || '');
    const title = String(cityTitle || '');
    const out = [];
    const seen = new Set();
    const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    let m;
    while ((m = re.exec(text))) {
        const target = m[1].trim();
        if (!target.includes('/')) continue;
        const prefix = target.split('/')[0];
        if (title && prefix.toLowerCase() !== title.toLowerCase()) continue;
        if (seen.has(target)) continue;
        seen.add(target);
        out.push(target);
        if (out.length >= Math.max(0, limit)) break;
    }
    return out;
}

/**
 * A city page: { summary, see, districts }.
 * `see` is every listing on the page; the job adds district pages only when there are not enough with coordinates.
 */
function parseCityPage(wikitext, title, { districts = 2 } = {}) {
    return {
        summary: leadSummary(wikitext),
        see: seeListings(wikitext),
        do: seeListings(wikitext, ['do']),
        districts: districtLinks(wikitext, title, districts),
    };
}

/** The page URL a citation goes to (a district page is a real Wikivoyage page too). */
function pageUrl(title) {
    return `https://en.wikivoyage.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_')).replace(/%2F/g, '/')}`;
}

module.exports = { stripWiki, leadSummary, seeListings, districtLinks, parseCityPage, pageUrl, splitParams, paramsOf, coordFrom, matchingBrace };
