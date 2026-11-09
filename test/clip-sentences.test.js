'use strict';
// Text people read is cut at a sentence, never in the middle of one (11-09: the Space Needle's "Why go" ended
// "…but the wine bar is still"). server/places/clip.js; the sources, the places job, the AI summary and the place
// page all use it.
//   node test/clip-sentences.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { clipSentences, finishedSentences } = require('../server/places/clip');

const needle = 'The view is spectacular. There are floor-to-ceiling windows on both levels. The revolving Sky City restaurant has been closed due to renovations, but the wine bar is still open in the afternoon.';
// A cut inside the third sentence keeps the first two.
assert.strictEqual(clipSentences(needle, 120), 'The view is spectacular. There are floor-to-ceiling windows on both levels.');
// Short text is unchanged (whitespace tidied).
assert.strictEqual(clipSentences('  One.  Two.  ', 100), 'One. Two.');
// A sentence ending exactly at the limit counts.
assert.strictEqual(clipSentences('Abc. Def.', 4), 'Abc.');
// One long first sentence: cut at a word, marked.
const long = clipSentences('A very long first sentence that keeps going and going without any end in sight at all', 30);
assert.ok(long.endsWith('…') && long.length <= 31 && !/\s…$/.test(long), long);
// Closing quotes and brackets stay with their sentence.
assert.strictEqual(clipSentences('He said "go there." Then more words follow here for a while.', 25), 'He said "go there."');
assert.strictEqual(clipSentences('', 10), '');
assert.strictEqual(clipSentences(null, 10), '');

// Stored text that was cut mid-sentence ends at its last finished sentence.
assert.strictEqual(finishedSentences('The view is spectacular. The wine bar is still'), 'The view is spectacular.');
assert.strictEqual(finishedSentences('Complete sentence.'), 'Complete sentence.');
assert.strictEqual(finishedSentences('Only an unfinished one,'), 'Only an unfinished one…');
assert.strictEqual(finishedSentences('Ends with a question?'), 'Ends with a question?');
assert.strictEqual(finishedSentences(''), '');

// Every place that used to slice shown text now clips at a sentence.
const root = path.join(__dirname, '..', 'server');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
assert.match(read('sources/wikivoyage.js'), /clipSentences\(plain, 1000\)/);
assert.match(read('sources/wikidata.js'), /clipSentences\(sentences\.slice\(1, 4\)\.join\(' '\), 600\)/);
assert.match(read('sources/osm.js'), /clipSentences\(tags\.description, 800\)/);
assert.match(read('jobs/places.js'), /clipSentences\(sentences\.slice\(1, 4\)\.join\(' '\), 600\)/);
assert.match(read('places/narrative.js'), /clipSentences\(r\.output\?\.text \|\| '', 800\)/);
assert.match(read('views/index.js'), /finishedSentences\(place\.description \|\| ''\)/);
console.log('clip sentences: never mid-sentence, at the source or on the page');
