'use strict';
// A picture is drawn only from a URL that is one (2026-11-01: a Wikivoyage listing's image field held a Google Photos
// share link, and the home drew a broken image). The function is server/views/index.js's own, run here.
//   node test/safe-image.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'views', 'index.js'), 'utf8');
const http = /const safeHttp = [^\n]+\n/.exec(src);
const hosts = /const IMAGE_HOSTS = [^\n]+\n/.exec(src);
const img = /const safeImage = \(v\) => \{[\s\S]*?\n\};\n/.exec(src);
assert.ok(http && hosts && img, 'views has safeHttp, IMAGE_HOSTS and safeImage');
const safeImage = new Function(`${http[0]}${hosts[0]}${img[0]}; return safeImage;`)();
const iw = /function imageWidth\(u, w\) \{[\s\S]*?\n\}\n/.exec(src);
assert.ok(iw, 'views has imageWidth');
const imageWidth = new Function(`${iw[0]}; return imageWidth;`)();

// Cards ask for the width they draw on both URL shapes Wikimedia's imageinfo returns, and on a
// stored original; no other host is rewritten.
const thumbUrl = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo.jpg/1280px-Foo.jpg?utm_source=commons.wikimedia.org';
assert.strictEqual(imageWidth(thumbUrl, 330), null, 'a Commons thumbnail keeps the verified imageinfo URL');
assert.strictEqual(imageWidth('https://upload.wikimedia.org/wikipedia/commons/5/51/Foo.png?utm_source=x', 640), null, 'an unscaled original keeps its URL because Wikimedia may reject an enlarged thumb');
assert.strictEqual(imageWidth('https://commons.wikimedia.org/wiki/Special:FilePath/Foo.jpg?width=1000', 330), 'https://commons.wikimedia.org/wiki/Special:FilePath/Foo.jpg?width=330', 'Special:FilePath takes a width');
assert.strictEqual(imageWidth('https://openvibe.media/t/x.jpg', 330), null, 'a Media path that is not a public object is not rewritten');
assert.strictEqual(imageWidth('https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo.jpg', 330), null, 'an original with a two-letter hash prefix keeps its URL');
assert.strictEqual(imageWidth(null, 330), null);
// Media's public objects take ?w= (WebP at its ladder, at most 640): a card no longer downloads the whole copy
// (11-09: 912 KB for one Nearby card, 37 KB at w=480). Wider than 640, the stored copy itself.
const obj = 'https://openvibe.media/o/med_01M6YPV5FV0XE5FV2EJW0TB9AA';
assert.strictEqual(imageWidth(obj, 330), obj + '?w=330', 'a Media picture at the card width');
assert.strictEqual(imageWidth(obj, 640), obj + '?w=640');
assert.strictEqual(imageWidth(obj, 1200), obj, 'wider than Media resizes: the stored copy');
assert.strictEqual(imageWidth(obj + '?w=160', 330), null, 'a URL that already asks for a size is left alone');

assert.strictEqual(safeImage('https://photos.app.goo.gl/A7PbTNW1RbBbZUrTA'), null, 'a share link is not a picture');
assert.ok(safeImage('https://upload.wikimedia.org/wikipedia/commons/a/ab/Hachiko.jpg'), 'Commons uploads');
assert.ok(safeImage('https://commons.wikimedia.org/wiki/Special:FilePath/Hachiko.jpg?width=640'), 'Commons file paths');
assert.ok(safeImage('https://openvibe.media/files/tower.webp'), 'an OpenVibe image');
assert.strictEqual(safeImage('https://openvibe.media/gallery'), null, 'a page is not a picture');
// Media answers a public object at /o/<id> (no extension): the place photos Tours copies there (11-08: all were refused).
assert.ok(safeImage('https://openvibe.media/o/med_01JCX9S3K2M4N5P6Q7R8S9T0VW'), 'a Media public object');
assert.strictEqual(safeImage('https://openvibe.media/o/../admin'), null, 'only an object id');
assert.strictEqual(safeImage('https://openvibe.media/o/'), null, 'an id is required');
// Only hosts the page's img-src allows: anything else would be refused and draw a broken image (2026-11-02).
assert.strictEqual(safeImage('https://images.mapillary.com/6Vri6u81GdjqVKBQTbQYBg/thumb-2048.jpg'), null, 'Mapillary is not allowed');
assert.strictEqual(safeImage('https://example.com/photos/tower.webp'), null, 'an image on another host');
assert.strictEqual(safeImage('http://upload.wikimedia.org/a.jpg'), null, 'https only');
const app = fs.readFileSync(path.join(__dirname, '..', 'server', 'app.js'), 'utf8');
const imgSrc = /imgSrc: \[([^\]]+)\]/.exec(app)[1];
for (const h of ['upload.wikimedia.org', 'commons.wikimedia.org', 'thumb.wikimedia.org', 'openvibe.media', 'openvibe.rent', 'openvibe.live', 'openvibe.network']) {
    assert.ok(imgSrc.includes(`'https://${h}'`), `${h} is in img-src as well`);
}
assert.strictEqual(safeImage('javascript:alert(1)'), null);
assert.strictEqual(safeImage(null), null);
assert.doesNotMatch(src, /safeHttp\((c|p|city|place)\.image_url\)/, 'every picture goes through safeImage');
console.log('safe image: all checks passed');
