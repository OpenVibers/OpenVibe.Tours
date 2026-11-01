'use strict';
// A picture is drawn only from a URL that is one (2026-11-01: a Wikivoyage listing's image field held a Google Photos
// share link, and the home drew a broken image). The function is server/views/index.js's own, run here.
//   node test/safe-image.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'views', 'index.js'), 'utf8');
const http = /const safeHttp = [^\n]+\n/.exec(src);
const img = /const safeImage = \(v\) => \{[\s\S]*?\n\};\n/.exec(src);
assert.ok(http && img, 'views has safeHttp and safeImage');
const safeImage = new Function(`${http[0]}${img[0]}; return safeImage;`)();

assert.strictEqual(safeImage('https://photos.app.goo.gl/A7PbTNW1RbBbZUrTA'), null, 'a share link is not a picture');
assert.ok(safeImage('https://upload.wikimedia.org/wikipedia/commons/a/ab/Hachiko.jpg'), 'Commons uploads');
assert.ok(safeImage('https://commons.wikimedia.org/wiki/Special:FilePath/Hachiko.jpg?width=640'), 'Commons file paths');
assert.ok(safeImage('https://example.com/photos/tower.webp'), 'a path ending in an image type');
assert.strictEqual(safeImage('https://example.com/gallery'), null, 'a page is not a picture');
assert.strictEqual(safeImage('javascript:alert(1)'), null);
assert.strictEqual(safeImage(null), null);
assert.doesNotMatch(src, /safeHttp\((c|p|city|place)\.image_url\)/, 'every picture goes through safeImage');
console.log('safe image: all checks passed');
