'use strict';
/**
 * The places job's photo pass (11-08: on launch every photo copy was refused, so places were stored without photos):
 * places with a Wikidata item and no photo are found, best ranked first; a found photo is stored with its credit; a
 * place with none is marked tried and not asked again for a week.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { seed } = require('./helpers/seed');
const osm = require('../server/sources/osm');

(async () => {
    const t = await boot();
    try {
        await seed(t);
        const city = await t.ctx.s.db.maybe('SELECT id FROM tours_cities ORDER BY id LIMIT 1');
        const place = (id, name, wikidata) => ({ ...osm.placeFromElement({ type: 'node', id, lat: 47.5, lon: -122.3, tags: { tourism: 'attraction', name, wikidata } }, city.id, new Date().toISOString()) });
        const a = await t.ctx.store.upsertPlace({ ...place(91001, 'Garden A', 'Q111'), rankScore: 900 });
        const b = await t.ctx.store.upsertPlace({ ...place(91002, 'Garden B', 'Q222'), rankScore: 100 });
        await t.ctx.store.upsertPlace({ ...place(91003, 'No item', undefined), rankScore: 999 });

        await check('places without a photo and with a Wikidata item, best ranked first', async () => {
            const bare = await t.ctx.store.placesWithoutPhoto({ limit: 200 });
            const ours = bare.filter((r) => [a, b].includes(r.id)).map((r) => r.id);
            assert.deepStrictEqual(ours, [a, b]);
            assert.ok(!bare.some((r) => r.name === 'No item'), 'a place with no Wikidata item has no photo to find');
        });

        await check('a found photo is stored with its credit; a place with none is not asked again for a week', async () => {
            assert.strictEqual(await t.ctx.store.setPlacePhoto(a, { imageUrl: 'https://openvibe.media/api/v2/tours/objects/obj_1', imageCredit: 'A photographer',
                imageLicense: 'CC BY-SA 4.0', imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg', gallery: [] }), true);
            assert.strictEqual(await t.ctx.store.setPlacePhoto(b, { id: b }), false);
            const row = await t.ctx.s.db.maybe('SELECT image_url, image_credit, photo_tried_at FROM tours_places WHERE id = $1', [a]);
            assert.strictEqual(row.image_credit, 'A photographer');
            const bare = (await t.ctx.store.placesWithoutPhoto({ limit: 200 })).map((r) => r.id);
            assert.ok(!bare.includes(a) && !bare.includes(b), 'neither is asked again this week');
        });
    } finally { await t.close(); }
    done();
})();
