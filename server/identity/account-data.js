'use strict';

/**
 * Account export and deletion → Tours (ADR-033; openvibe-sdk/account-data).
 *
 * A person's own rows are their trips. Saved places, the chosen route and stays are part of the trip and go with it
 * (ON DELETE CASCADE). Public cities, places, routes, live rows and stays are open data, not a person's, and stay.
 * No row holds a token.
 */
const { createAccountData, TOPICS } = require('openvibe-sdk/account-data');

const TABLES = [
    { table: 'tours_trips', subject: 'owner_subject', file: 'trips.json', erase: 'delete' },
];

function create({ db, log = console } = {}) {
    return createAccountData({
        db,
        service: 'tours',
        tables: TABLES,
        /**
         * A share row names its owner and its members by canonical subject, which a table map cannot cover: the
         * trip's own rows go, and so must the share row and everyone it named, or a deleted account would linger in
         * somebody else's trip's member list. Children first: share_members, transfers and requests point at shares.
         */
        extraErase: async (t, subjects) => {
            for (const subject of subjects) {
                const id = String(subject).replace(/^user:/, '');
                await t.exec("DELETE FROM share_members WHERE service='tours' AND subject->>'id' = $1", [id]);
                await t.exec("DELETE FROM share_transfers WHERE service='tours' AND (from_subject->>'id' = $1 OR to_subject->>'id' = $1)", [id]);
                await t.exec("DELETE FROM share_access_requests WHERE service='tours' AND subject->>'id' = $1", [id]);
            }
            for (const subject of subjects) {
                const id = String(subject).replace(/^user:/, '');
                const owned = await t.many("SELECT kind, resource_id FROM shares WHERE service='tours' AND owner_subject->>'id' = $1", [id]);
                for (const row of owned) {
                    await t.exec("DELETE FROM share_members WHERE service='tours' AND kind=$1 AND resource_id=$2", [row.kind, row.resource_id]);
                    await t.exec("DELETE FROM share_transfers WHERE service='tours' AND kind=$1 AND resource_id=$2", [row.kind, row.resource_id]);
                    await t.exec("DELETE FROM share_access_requests WHERE service='tours' AND kind=$1 AND resource_id=$2", [row.kind, row.resource_id]);
                    await t.exec("DELETE FROM shares WHERE service='tours' AND kind=$1 AND resource_id=$2", [row.kind, row.resource_id]);
                }
            }
        },
        note: 'Your trips and everything saved on them are erased. Public cities, places and routes are open data and stay.',
        log,
    });
}

module.exports = { create, TABLES, TOPICS };
