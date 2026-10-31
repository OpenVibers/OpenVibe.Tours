'use strict';
/**
 * ADR-033: Tours' part of an account export and deletion, applied through /internal/events with a stand-in Network.
 * A person's trips are exported; on deletion they are erased (saved places, route and stays cascade) and another
 * person's trips are untouched. A redelivery changes nothing; a bad signature and a proxied request are refused.
 */
const assert = require('assert');
const http = require('http');
const { ids } = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');
const { createNetworkSender } = require('openvibe-sdk/account-data');
const { signDeliveryHeaders } = require('openvibe-sdk/events');

const A = ids.newId('user');
const B = ids.newId('user');
const EXP = `exp_${ids.ulid()}`;
const DEL = `del_${ids.ulid()}`;
const SECRET = `fixture_${'account'.repeat(6)}`;
const WRONG = `fixture_${'mismatch'.repeat(6)}`;

const exportEvent = { event_id: `evt_${ids.ulid()}`, event_type: 'network.account.export_requested', source: 'network', payload: { export_id: EXP, subject: A } };
const deleteEvent = { event_id: `evt_${ids.ulid()}`, event_type: 'network.account.deleted', source: 'network', payload: { deletion_id: DEL, subject: A, aliases: [] } };
const bodyOf = (ev) => JSON.stringify({ event: ev, seq: 1 });

async function startNetworkStub() {
    const calls = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks);
            const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
            if (req.url === '/oauth/token') return json(200, { access_token: 'tok_tours', token_type: 'Bearer', expires_in: 300 });
            calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw.toString() || 'null') });
            return json(201, {});
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

(async () => {
    const stub = await startNetworkStub();
    const sender = createNetworkSender({ networkInternalUrl: stub.url, clientId: 'tours', clientSecret: 'tours-secret' });
    const t = await boot({ env: { TOURS_EVENTS_SECRET: SECRET }, accountSend: sender });
    const db = t.ctx.s.db;
    try {
        const city = await db.maybe("SELECT id FROM tours_cities LIMIT 1");
        const tripA = `trp_${ids.ulid()}`;
        const tripB = `trp_${ids.ulid()}`;
        await db.exec(`INSERT INTO tours_trips (id, slug, owner_subject, title, city_id, starts_on, ends_on)
            VALUES ($1, 'trip-aaaaaaaaaaaaaaaaaaaaaaaa', $2, 'Kim in Lisbon', $3, '2026-11-10', '2026-11-12'),
                   ($4, 'trip-bbbbbbbbbbbbbbbbbbbbbbbb', $5, 'Sam in Lisbon', $3, '2026-12-01', '2026-12-03')`,
        [tripA, A, city ? city.id : null, tripB, B]);

        await check('an export carries only A\'s trips', async () => {
            const body = bodyOf(exportEvent);
            const res = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, SECRET) } });
            assert.strictEqual(res.status, 200, res.text);
            assert.strictEqual(res.json().outcome, 'exported');
            const part = stub.calls.find((c) => c.url === `/internal/account-exports/${EXP}/parts`);
            assert.ok(part, 'the part was pushed to Network');
            assert.strictEqual(part.auth, 'Bearer tok_tours');
            assert.strictEqual(part.body.subject, A);
            const trips = part.body.files.find((f) => f.name === 'trips.json');
            assert.ok(trips, part.body.files.map((f) => f.name).join(','));
            assert.match(JSON.stringify(trips), /Kim in Lisbon/);
            assert.ok(!JSON.stringify(part.body).includes('Sam in Lisbon'), 'nobody else\'s trip');
        });

        await check('a deletion erases A\'s trips and leaves B alone', async () => {
            const body = bodyOf(deleteEvent);
            const res = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, SECRET) } });
            assert.strictEqual(res.status, 200, res.text);
            assert.strictEqual(res.json().outcome, 'erased');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int FROM tours_trips WHERE owner_subject = $1', [A])), 0);
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int FROM tours_trips WHERE owner_subject = $1', [B])), 1);
            const confirmation = stub.calls.find((c) => c.url === `/internal/account-deletions/${DEL}/confirmations`);
            assert.ok(confirmation, 'the confirmation was sent');
            assert.ok(Number(confirmation.body.erased.tours_trips) >= 1);
        });

        await check('a redelivery changes nothing; a bad signature is 401 and a forwarded request is 403', async () => {
            const body = bodyOf(deleteEvent);
            const again = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, SECRET) } });
            assert.strictEqual(again.status, 200);
            assert.strictEqual(again.json().outcome, 'unchanged');
            const bad = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, WRONG) } });
            assert.strictEqual(bad.status, 401);
            const forwarded = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9', ...signDeliveryHeaders(body, SECRET) } });
            assert.strictEqual(forwarded.status, 403);
        });
    } finally {
        await t.close();
        await stub.close();
    }
    done();
})();
