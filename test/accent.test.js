'use strict';
/**
 * The room's accent passes WCAG AA for text in both themes: the dark accent against the dark canvas and the light
 * accent against white, at 4.5:1 or more. rooms.js is the one table every site reads.
 */
const assert = require('assert');
const rooms = require('openvibe-shared/rooms');

function luminance(hex) {
    const h = String(hex).replace('#', '');
    const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a, b) {
    const l1 = luminance(a); const l2 = luminance(b);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
}

const room = rooms.get('tours');
assert.ok(room, 'rooms.js has the tours room');
assert.strictEqual(room.host, 'openvibe.tours');
assert.ok(contrast(room.dark, '#0B0D12') >= 4.5, `dark accent ${room.dark} on #0B0D12 = ${contrast(room.dark, '#0B0D12').toFixed(2)}:1`);
assert.ok(contrast(room.light, '#FFFFFF') >= 4.5, `light accent ${room.light} on white = ${contrast(room.light, '#FFFFFF').toFixed(2)}:1`);
assert.match(rooms.style('tours'), /--room-dark:#F98942;--room-light:#AA3900/);
process.stdout.write(`  ✓ tours accent ${room.dark} on #0B0D12 (${contrast(room.dark, '#0B0D12').toFixed(2)}:1) and ${room.light} on white (${contrast(room.light, '#FFFFFF').toFixed(2)}:1)\n\nall passed\n`);
