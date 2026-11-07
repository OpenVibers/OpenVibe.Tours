'use strict';
// The home's walk and live scenes show the first real route's stops and the first real IRL stream (or recording); the
// trip scene is an itinerary illustration labelled Example. With no route or stream they say so, and the written-in
// Lisbon stops and "Category IRL" card are gone.
const assert = require('assert');
const views = require('../server/views');

const route = { slug: 'lisbon-see', title: 'Lisbon See list', city_name: 'Lisbon', stops: [{ title: 'Real stop one' }, { title: 'Real stop two' }] };
const live = [{ kind: 'stream', username: 'realstreamer', display_name: 'Real Streamer', title: 'A real walk', viewer_count: 7, category: 'IRL', url: 'https://openvibe.live/@realstreamer' }];
const page = views.home({ route, live });
assert.ok(page.includes('Real stop one') && page.includes('Real stop two'), 'the route\'s own stops');
assert.ok(page.includes('href="/routes/lisbon-see"'), 'the route is linked');
assert.ok(page.includes('A real walk') && page.includes('Real Streamer') && page.includes('7 watching'), 'the real live stream and its viewer count');
assert.ok(page.includes('href="https://openvibe.live/@realstreamer"'), 'the stream links out');
assert.ok(!/Castelo de S|Lisbon Cathedral|Miradouro de Santa Luzia|Category IRL/.test(page), 'no written-in route or category');

const empty = views.home({});
assert.ok(empty.includes('No route built yet'), 'no route: says so');
assert.ok(empty.includes('Nobody is live right now'), 'no stream: says so');
assert.ok(empty.includes('Example itinerary'), 'the trip illustration is labelled');
assert.ok(!/Castelo de S|Lisbon Cathedral|Miradouro de Santa Luzia|Category IRL/.test(empty), 'no written-in route or live card');

console.log('tours home: the walk and live scenes read the real route and stream, or say there is none');
