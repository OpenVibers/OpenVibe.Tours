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
        note: 'Your trips and everything saved on them are erased. Public cities, places and routes are open data and stay.',
        log,
    });
}

module.exports = { create, TABLES, TOPICS };
