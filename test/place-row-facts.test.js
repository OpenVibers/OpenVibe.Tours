'use strict';
/**
 * A city's place rows say each fact once and plainly: "step-free · free to visit", not "step-free · free" (which read as
 * the same word twice on /city/delhi, 2026-11-02).
 *
 *   node test/place-row-facts.test.js
 */
const assert = require('assert');
const views = require('../server/views');

const city = { slug: 'delhi', name: 'Delhi', country: 'India', summary: 'The capital.', lat: 28.6, lon: 77.2 };
const place = { id: 'plc_1', name: 'Grass Sculptures', kind: 'artwork', address: 'Netaji Subhash Marg, 110006, Delhi', wheelchair: 'yes', fee: 'no', lat: 28.6, lon: 77.2 };
const html = views.cityPage({ city, places: [place] });
assert.ok(html.includes('step-free · free to visit'), 'both facts, each said once');
assert.ok(!/step-free · free(?! to visit)/.test(html), 'never "step-free · free"');
console.log('place row facts: step-free · free to visit');
