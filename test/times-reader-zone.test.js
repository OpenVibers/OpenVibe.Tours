'use strict';
// Plan item 13: a moment on a Tours page is said in the reader's own zone and clock. A full instant becomes a <time
// data-ov-time> that Shared's theme loader rewrites; the UTC words stay as the fallback (11-28: /live listed
// "ended 2026-11-26 18:31:21 UTC" to everyone).
const assert = require('assert');
const { livePage } = require('../server/views');

const html = livePage({
    live: [],
    recent: [{ url: 'https://openvibe.video/v/77', title: 'A walk <home>', username: 'bo', ended_at: '2026-11-26T18:31:21.000Z', fetched_at: '2026-11-28T07:52:39.000Z', kind: 'vod' }],
});
assert.match(html, /<time datetime="2026-11-26T18:31:21\.000Z" data-ov-time="day">2026-11-26 18:31:21 UTC<\/time>/, 'ended: a time the reader\'s zone rewrites');
assert.match(html, /fetched <time datetime="2026-11-28T07:52:39\.000Z" data-ov-time="day">2026-11-28 07:52:39 UTC<\/time>/, 'fetched: the same');
assert.ok(!html.includes('<home>'), 'titles stay escaped');
console.log('times-reader-zone: Tours says each moment in the reader\'s own zone, UTC words as the fallback');
