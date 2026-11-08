'use strict';
const assert = require('node:assert/strict');
const { boot, check, done } = require('./helpers/boot');
const { createIndexNow } = require('../server/index-now');
const KEY = 'testkey1';

(async () => {
    await check('IndexNow batches only canonical city and place pages', async () => {
        const posts = [];
        const index = createIndexNow({ baseUrl: 'https://openvibe.tours', key: KEY,
            fetchImpl: async (_url, options) => { posts.push(JSON.parse(options.body)); return { status: 200 }; } });
        index.add('/city/seattle'); index.add('/city/seattle/free');
        index.add('/place/kubota-garden-plc_0123456789ABCDEFGHJKMNPQRS');
        index.add('/place/not-a-real-id'); index.add('https://elsewhere.example/');
        await index.flush();
        assert.strictEqual(posts.length, 1);
        assert.deepEqual(posts[0].urlList, [
            'https://openvibe.tours/city/seattle', 'https://openvibe.tours/city/seattle/free',
            'https://openvibe.tours/place/kubota-garden-plc_0123456789ABCDEFGHJKMNPQRS',
        ]);
        assert.strictEqual(posts[0].key, KEY);
    });
    const t = await boot({ env: { INDEXNOW_KEY: KEY } });
    try {
        await check('IndexNow ownership key is served as a public text file', async () => {
            const response = await t.get(`/${KEY}.txt`);
            assert.strictEqual(response.status, 200);
            assert.strictEqual(response.text, KEY);
        });
    } finally { await t.close(); }
    done();
})().catch((err) => { process.stdout.write(String(err.stack || err)); process.exit(1); });
