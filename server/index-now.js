'use strict';

const { createIndexNow: sharedIndexNow } = require('openvibe-shared/indexnow');

function createIndexNow({ baseUrl, key, fetchImpl, log } = {}) {
    const client = sharedIndexNow({ host: baseUrl, key, fetch: fetchImpl, log });
    const origin = String(baseUrl || 'https://openvibe.tours').replace(/\/+$/, '');
    function add(path) {
        if (!/^\/(?:city\/[a-z0-9-]+(?:\/free)?|place\/[a-z0-9-]+-plc_[0-9A-HJKMNP-TV-Z]{26})$/.test(path)) return;
        client.pingSoon(`${origin}${path}`);
    }
    return { ...client, add };
}

module.exports = { createIndexNow };
