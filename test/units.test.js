'use strict';
/**
 * Pure rules: Wikivoyage wikitext → summary/See listings, stable ids and slugs, Live IRL classification and URL
 * normalisation, and the Rent listing shape. No network, no database.
 */
const assert = require('assert');
const { parseCityPage, stripWiki, seeListings, districtLinks, leadSummary } = require('../server/sources/wikivoyage');
const { stableId, slugify } = require('../server/store');
const { isIrl, utc, vodOf, streamOf } = require('../server/sources/live');
const { stayOf } = require('../server/sources/rent');

let failures = 0;
function check(name, fn) {
    try { fn(); process.stdout.write(`  ✓ ${name}\n`); } catch (e) { failures += 1; process.stdout.write(`  ✗ ${name}\n      ${(e.stack || String(e)).split('\n').slice(0, 8).join('\n      ')}\n`); }
}

check('stripWiki keeps the last character, follows links and removes templates, files and refs', () => {
    assert.strictEqual(stripWiki('Ueno Park'), 'Ueno Park');
    assert.strictEqual(stripWiki("[[Tokyo/Asakusa|Asakusa]]'s '''Senso-ji''' is [[Buddhist]].", {}), "Asakusa's Senso-ji is Buddhist.");
    assert.strictEqual(stripWiki('A {{m|28}} statue<ref>source</ref>'), 'A statue');
    assert.strictEqual(stripWiki('[[File:Photo.jpg|thumb|Caption]] A temple.'), 'A temple.');
});

check('leadSummary takes the first real paragraph and skips templates, headings and files', () => {
    const text = "{{pagebanner|X.jpg}}\n\n'''Lisbon''' is Portugal's capital, built on seven hills above the River Tagus, with trams climbing between viewpoints, tiled façades and old neighbourhoods.\n\n==See==\n";
    assert.match(leadSummary(text), /Portugal's capital/);
    assert.ok(!leadSummary(text).includes('pagebanner'));
});

check('seeListings reads name, coordinates, note and old listing templates; districtLinks finds subpages', () => {
    const wikitext = `==See==
{{see | name=Senso-ji | lat=35.7148 | long=139.7967 | content=A temple in [[Asakusa]].}}
{{listing | type=see | name=Ueno Park | lat=35.7156 | long=139.7745 | content=A park.}}
[[Lisbon/Alfama|Alfama]] and [[Tokyo/Asakusa|Asakusa]]`;
    const parsed = parseCityPage(wikitext, 'Lisbon');
    assert.strictEqual(parsed.see.length, 2);
    assert.strictEqual(parsed.see[0].name, 'Senso-ji');
    assert.strictEqual(parsed.see[0].lat, 35.7148);
    assert.strictEqual(parsed.see[0].note, 'A temple in Asakusa.');
    assert.ok(parsed.see.every((x) => x.hasCoords));
    assert.deepStrictEqual(parsed.districts, ['Lisbon/Alfama']);
    assert.deepStrictEqual(districtLinks('[[Lisbon/A|A]] [[Lisbon/B|B]] [[Porto/C|C]]', 'Lisbon', 1), ['Lisbon/A']);
    assert.strictEqual(seeListings('{{see|name=No coords|content=X}}')[0].hasCoords, false);
});

check('stable ids are deterministic Crockford ids; slugs strip accents and punctuation', () => {
    assert.strictEqual(stableId('plc', 'node:1'), stableId('plc', 'node:1'));
    assert.notStrictEqual(stableId('plc', 'node:1'), stableId('plc', 'node:2'));
    assert.match(stableId('plc', 'node:1'), /^plc_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.strictEqual(slugify('Bogotá'), 'bogota');
    assert.strictEqual(slugify('Washington, D.C.'), 'washington-d-c');
    assert.strictEqual(slugify('Saint Petersburg'), 'saint-petersburg');
});

check('Live is IRL by category, tag or plain title; timestamps are UTC; VODs link the video page', () => {
    assert.strictEqual(isIrl({ category: 'irl', title: 'x', tags: '[]' }), true);
    assert.strictEqual(isIrl({ category: 'other', title: 'x', tags: '["irl"]' }), true);
    assert.strictEqual(isIrl({ category: 'other', title: 'A walk through the market', tags: '[]' }), true);
    assert.strictEqual(isIrl({ category: 'gaming', title: 'Ranked', tags: '[]' }), false);
    assert.strictEqual(utc('2026-10-31 10:00:00'), '2026-10-31T10:00:00.000Z');
    const item = { id: 2, username: 'bo', title: 'IRL tour', category: 'travel', tags: '["irl"]', started_at: '2026-10-30 09:00:00', ended_at: '2026-10-30 10:00:00', vod_id: 77 };
    const vod = vodOf(item, { fetchedAt: '2026-11-01T00:00:00.000Z', liveUrl: 'https://openvibe.live', videoBase: 'https://openvibe.video' });
    assert.strictEqual(vod.url, 'https://openvibe.video/v/77');
    assert.strictEqual(vod.kind, 'vod');
    assert.strictEqual(streamOf(item, { fetchedAt: '2026-11-01T00:00:00.000Z', liveUrl: 'https://openvibe.live', videoBase: 'https://openvibe.video' }).url, 'https://openvibe.live/@bo');
});

check('Rent stays accept only a valid rnt id, kind, period, currency and price', () => {
    const good = { id: 'rnt_01JABCDEFGHJKMNPQRSTVWXYZ0', kind: 'apartment', title: 'A flat', price: 1200, currency: 'EUR', period: 'month', city: 'Lisbon', neighbourhood: 'Alfama' };
    const stay = stayOf(good, { fetchedAt: '2026-11-01T00:00:00.000Z', cityId: 'cty_x', cityName: 'Lisbon', rentUrl: 'https://openvibe.rent' });
    assert.strictEqual(stay.externalId, good.id);
    assert.strictEqual(stay.price, 1200);
    assert.strictEqual(stay.url, 'https://openvibe.rent/listings/' + good.id);
    for (const bad of [{ ...good, id: 'bad' }, { ...good, kind: 'castle' }, { ...good, period: 'century' }, { ...good, currency: 'eur' }, { ...good, price: -1 }]) {
        assert.strictEqual(stayOf(bad, { fetchedAt: 'x', cityName: 'Lisbon', rentUrl: 'https://openvibe.rent' }), null);
    }
});

process.stdout.write(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
