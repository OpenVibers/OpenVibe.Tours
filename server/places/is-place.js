'use strict';

// A ticket product, seller or shop is never a destination, even if a source tags it as an attraction.
function isPlace(name, { shop, office, instanceLabel = '' } = {}) {
    if (shop || office) return false;
    const text = `${name || ''} ${instanceLabel}`;
    return !/\b(?:city\s*pass|citypass|pass(?:es)?|ticket(?:s|ing)?|tours|excursions?|tour\s*(?:operator|company|agency)|travel\s*agency|shop|store|retail(?:er)?)\b/i.test(text);
}

module.exports = { isPlace };
