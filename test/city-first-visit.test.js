'use strict';
/**
 * A city's first visit answers within CITY_WAIT_MS while its discovery goes on (Seattle took over a minute and the
 * proxy answered 503, 11-08): a page that says it is gathering the city and refreshes itself, or the city with what
 * is stored so far, also refreshing.
 *
 *   node test/city-first-visit.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pages = fs.readFileSync(path.join(__dirname, '..', 'server', 'http', 'pages.js'), 'utf8');
const route = pages.slice(pages.indexOf('const CITY_WAIT_MS'), pages.indexOf("store.cityPlaces(city.id, { limit: 60 })"));
assert.match(route, /const CITY_WAIT_MS = 20_000;/, 'twenty seconds at most');
assert.match(route, /soon\(discover\.ensureCity\(name\), 'city lookup'\)/, 'a new city is looked up with the limit');
assert.match(route, /res\.set\('Refresh', '12'\);\s*return page\(req, res, \{ index: false, title: `Gathering \$\{name\}`, body: raw\(views\.gathering\(name\)\) \}, 200\);/, 'not yet found: the gathering page, refreshing');
assert.match(route, /soon\(jobs\.places\.populateCity\(city\), 'city places'\)/, 'places are gathered with the limit');
assert.match(route, /if \(gathering\) res\.set\('Refresh', '15'\);/, 'a city still filling refreshes itself');
const views = require('../server/views');
const html = views.gathering('Seattle <x>');
assert.ok(html.includes('Gathering Seattle &lt;x&gt;'), 'the name is escaped');
assert.ok(!/spinner|loading-ring/i.test(html), 'words, not a spinner');
console.log('city first visit: answers within 20 s and refreshes itself while the city is gathered');
