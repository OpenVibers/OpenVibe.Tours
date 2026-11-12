# AGENTS.md — OpenVibe.Tours

## Project overview

OpenVibe.Tours (`https://openvibe.tours`) is the network's travel room: cities and places from open
data, IRL live tours and stays from the network's public APIs, self-guided routes with cited stops,
and a signed-in person's trips. Everything is server-rendered and works without JavaScript.

- **Entry:** `server/index.js`; app in `server/http/router.js`; port `5170`, service id `tours`.
- **Sources:** `server/sources/` — `osm.js` (Overpass), `wikidata.js`, `wikivoyage.js`/
  `wikivoyage-client.js`, `live.js` (Live's public list), `rent.js` (Rent's public listings),
  `openverse.js`, `http.js`.
- **Places:** `server/places/` — `discover.js`, `is-place.js`, `narrative.js` (AI summary + attribution),
  `photo-cache.js` (licensed images to Media), `clip.js`.
- **Jobs:** `server/jobs/` — `cities.js`, `places.js`, `routes.js`, `live.js`, `stays.js`, `index.js`.
- **API/pages:** `server/http/api.js` (`/api/v1`), `principal.js`, `pages.js`, `discovery.js`;
  views in `server/views/index.js`/`labels.js`, rendering in `server/render/layout.js`/`html.js`.
  `public/js/tours.js` is the only own browser script (MapLibre only on the route page); own CSS in
  `public/css`.
- **Seeds:** `seed/`, `scripts/seed.js`; status and counts in `STATUS.json`.

## Owns, does not own

Owns its cached open data: `tours_cities` (`cty_`), `tours_city_sources`, `tours_places` (`plc_`),
`tours_routes` (`rte_`), `tours_route_stops`, the trips/shares tables and its outbox. Every row keeps
the source URL and the time fetched.

Does not own: Live, Rent, Media and AI — Tours reads Live's and Rent's public pages/lists; licensed
place images are copied to Media with the `media.object.upload` service scope; sourced summaries use
AI (`ai.run.create`, `ai.run.read`) when `OV_AI_INTERNAL_URL` is configured. Both keep the original
source and attribution on the place page. Identity/roles are Network's (OAuth client `tours`, PKCE
S256, canonical `usr_…`). OpenStreetMap, Wikivoyage, Wikidata and Commons are external open data,
cached with source and fetched time — never scraped past their terms. Tours never takes a payment and
carries **no affiliate link**.

## Who calls it, what it calls

People use the pages/API with the `tours_at` session cookie or a Network Bearer token. Trips and saved
places are the person's own; a share link is read-only. Tours calls Network (SSO, JWKS, identity),
Live's public stream/VOD list, Rent's public listings, Media (image upload), AI (summaries when
configured), and the open-data endpoints (Wikidata, Wikivoyage, Overpass, Commons, Openverse) through
`server/sources/`. It calls no service with a person's write; the public reads are cacheable, a person's
page is `private, no-store`.

## Database and migrations

PostgreSQL through `openvibe-sdk/db`; migrations `migrations/0001..0011` (initial, place sources,
search index, English names, shares/defaults, outbox, discoverable/notable places, photo retries) are
applied at boot with the owner role. Tests use PGlite; `npm run test:pg` runs them on PostgreSQL.
Never edit a migration that has run. A job records what it fetched; a failed source leaves the cached
row and its fetched time rather than inventing content.

## Auth

Network SSO (RS256 JWT + `tours_at` cookie) and offline JWKS verification. A write made with the
session cookie must come from `https://openvibe.tours`, else `403 tours.cross_site`. Every person
acts only on their own trips and saved places; a share link is an unguessable read-only token.
`/internal/events` is HMAC-verified and loopback-only.

## Deploy

`deploy/systemd/openvibe-tours.service` (port `5170`, env `/etc/openvibe/tours.env`, checkout
`/opt/openvibe.tours`) and `deploy/nginx/openvibe.tours.conf` (the forms zone covers `/trips`);
`sudo ovhost deploy tours` is the production path and `sudo ovhost rollback tours --to <sha>` the
rollback.

## Commands and tests

```bash
npm ci
npm run dev                  # http://127.0.0.1:5170
npm test                     # every test/*.test.js, PGlite + in-process mocks
npm test -- places routes    # only matching files
npm run test:pg              # the same on PostgreSQL
npm run seed                 # seed cities/places from the open sources
```

`test/run.js` uses `openvibe-shared/test-runner` (90 s, serial); temp PGlite plus in-process Network,
Live, Chat, Today and OSM/Ticketmaster fixtures, never the network. Tests cover the sources and
parsers, place discovery, routes and stops, trips/shares, the pages, accent contrast, account data,
agent twins and discovery artifacts.

## Conventions and pitfalls

- CommonJS, 4-space indent, single quotes, semicolons; problem+json with a stable code. No linter.
- **Every fact carries its source and fetched time** (city, place, route, stop, photo licence). A
  missing or failed source is shown honestly; never invent a place, a date, an opening time or a route.
- **No affiliate and no payment.** Flights are a link to the official search; v1 had no flight API key.
  The Duffel/Kiwi seam stays off, and a key alone does not turn it on.
- **TTS is off** until AI has a speech route: every stop says so instead of shipping a dead player.
- **Attribution is part of the data:** copying a photo to Media or summarising with AI keeps the
  original source and licence on the place page.
- **Routes are generated and marked generated**, every stop cited; the no-JavaScript version is a
  complete SVG + ordered list, not an empty map.
- **Respect the open-data terms:** no bulk scraping past Overpass/Wikivoyage/Wikidata/Commons limits;
  use the cached row while a source is unavailable.
- New env names go into `.env.example` and the README; secret values live only in
  `/etc/openvibe/tours.env`.
