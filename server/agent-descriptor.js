'use strict';
// What OpenVibe.Tours tells an agent about itself (openvibe-shared/agent-layer): /.well-known/agent.json (SEO-2).
// Every field is something this site really serves; the purpose is its own llms.txt summary.
module.exports = {
    id: "tours",
    name: "OpenVibe.Tours",
    purpose: "Go anywhere: cities, places and self-guided routes from OpenStreetMap, Wikivoyage and Wikidata, IRL tours live on OpenVibe.Live, stays from OpenVibe.Rent, and flights.",
    home: "https://openvibe.tours",
    site: "openvibe.tours",
    api: "/api/v1",
    docs: "/developers",
    openapi: '/openapi.json',
    policy: {
        auth: ["none"],
    },
};
