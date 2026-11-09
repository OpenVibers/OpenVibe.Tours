'use strict';

// Text shown to people is cut at a sentence, never in the middle of one. Fixed slices cut Wikivoyage, Wikidata and OSM
// descriptions mid-sentence, and the place page printed them as written: the Space Needle's "Why go" ended
// "…but the wine bar is still" (11-09).

// A sentence ends at . ! ? or … , maybe followed by a closing quote or bracket, then a space or the end.
const END = /[.!?…]["'”’)\]]?(?=\s|$)/g;

/**
 * `text` in at most `max` characters, ending at a sentence end. When even the first sentence is longer than `max`,
 * it is cut at the last word that fits and marked with "…". Short text is returned unchanged.
 */
function clipSentences(text, max) {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!t || t.length <= max) return t;
    const head = t.slice(0, max + 1);   // + 1: a sentence that ends exactly at max still counts
    let cut = -1;
    for (const m of head.matchAll(END)) if (m.index + m[0].length <= max) cut = m.index + m[0].length;
    if (cut > 0) return t.slice(0, cut).trim();
    const space = t.lastIndexOf(' ', max - 1);
    return `${t.slice(0, space > 0 ? space : max - 1).replace(/[\s,;:–—-]+$/, '')}…`;
}

/**
 * Text already stored cut mid-sentence: drop the unfinished tail when a finished sentence comes before it, so a page
 * never ends in the middle of a sentence. Text that is one unfinished sentence keeps its words and gains "…".
 */
function finishedSentences(text) {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!t || /[.!?…]["'”’)\]]?$/.test(t)) return t;
    let cut = -1;
    for (const m of t.matchAll(END)) cut = m.index + m[0].length;
    return cut > 0 ? t.slice(0, cut).trim() : `${t.replace(/[\s,;:–—-]+$/, '')}…`;
}

module.exports = { clipSentences, finishedSentences };
