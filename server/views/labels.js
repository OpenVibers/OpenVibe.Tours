'use strict';

/** The small words the pages share: job status and a few labels. */
const JOB_STATUS = {
    running: 'running',
    ok: 'ok',
    partial: 'partly fetched',
    failed: 'failed',
};

const stateLabel = (s) => JOB_STATUS[s] || String(s || 'unknown');

module.exports = { stateLabel, JOB_STATUS };
