'use strict';
// The cities job reads its list from seed/top-cities.json, which is committed. It once read data/, which is the
// development database's folder and not in git, so production started with no cities (10-31).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed/top-cities.json'), 'utf8'));
assert.ok(Array.isArray(list) && list.length >= 50, `a real list of cities (${list.length})`);
for (const c of list) assert.ok(c && typeof c.name === 'string' && c.name && typeof c.country === 'string' && c.country, JSON.stringify(c));
const job = fs.readFileSync(path.join(__dirname, '..', 'server/jobs/cities.js'), 'utf8');
assert.match(job, /path\.join\(__dirname, '\.\.', '\.\.', 'seed', 'top-cities\.json'\)/, 'the job reads the committed list');
const ignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
assert.ok(!/^seed\/?$/m.test(ignore), 'seed/ is not ignored');
console.log(`tours seed list: ${list.length} cities, committed and read from seed/`);
