# OpenVibe.Tours

> Go anywhere: fly, stay, walk, watch.

**Status:** v1 written, seeded and tested (see [STATUS.json](STATUS.json)).
**Domain:** `openvibe.tours` · **Port:** 5170 · **Service id:** `tours` · **Env prefix:** `TOURS`
**License:** AGPL-3.0-only (the same as every OpenVibe service).

OpenVibe.Tours is the travel room. V1 has six things, all from open data or the network's public APIs:

- **Places.** The top 100 cities from Wikidata and Wikivoyage, then `tourism=*` places from OpenStreetMap through
  Overpass, with the city's Wikivoyage See listings as a cited fallback when Overpass is queueing. A page per city (`/city/<slug>`) and per place (`/place/<id>`) with the source and the fetch time, plus
  a **place of the day** chosen deterministically from the same data.
- **Live tours.** IRL streams from OpenVibe.Live's public stream list, and recent IRL VODs and clips, with a city
  when the public title or tags name one. Tours reads the public list; it never follows, chats or writes.
- **Stays.** Active rentals from OpenVibe.Rent's public listings for the city. Tours never takes a payment.
- **Self-guided routes.** Ordered stops on a map (MapLibre + OpenStreetMap tiles, with a complete SVG and list
  without JavaScript), generated from Wikivoyage's See lists, marked as generated, every stop cited. TTS audio is
  off: OpenVibe.AI has no speech-synthesis route today, so every stop says so instead of shipping a dead player.
- **Flights.** No flight API key in v1. The form opens the official airline-neutral search with the city pair and
  dates filled in. **No affiliate.** The Duffel/Kiwi seam is off, and a key alone does not turn it on.
- **Trips.** A signed-in person's trip: a city, dates, saved places, one route, stays, and a read-only share link.
  Group voting is v2.

## Owns

| Table | Holds | Migration |
|---|---|---|
| `tours_cities` | `cty_` + stable id, slug, name, country/ISO code, coordinates, population, Wikidata Q id, Wikivoyage title, summary, image + Commons licence, source URL, fetched time | `migrations/0001_initial.sql` |
| `tours_city_sources` | the Wikivoyage pages (city + district) a city's summary, See listings and routes come from | `0001_initial.sql` |
| `tours_places` | `plc_` + stable id, city, OSM type/id, name, `tourism=*` kind, coordinates, address, hours, wheelchair, fee, Wikidata/Wikipedia, image, source URL, fetched time | `0001_initial.sql` |
| `tours_routes` | `rte_` + stable id, city, slug, title, summary, distance, duration, stop count, generated flag, Wikivoyage source, fetched time | `0001_initial.sql` |
| `tours_route_stops` | ordered stop, optional place, cited note, coordinates, Wikivoyage URL, audio status/url | `0001_initial.sql` |
| `tours_live` | `liv_` + stable id, `stream\|vod\|clip`, Live/Media id, username, title, category, viewers, city when named, public URL, times, fetched time | `0001_initial.sql` |
| `tours_stays` | `sty_` + stable id, Rent `rnt_` id, city, title, kind, price/currency/period, neighbourhood, public URL, fetched time | `0001_initial.sql` |
| `tours_trips` | `trp_` + ULID, share slug, owner subject, title, city, dates, notes, `private\|shared`, revision | `0001_initial.sql` |
| `tours_trip_places`, `tours_trip_routes`, `tours_trip_stays` | what the person saved on the trip (cascade with it) | `0001_initial.sql` |
| `tours_job_runs` | each source job's start/finish, status, counts and error | `0001_initial.sql` |
| `account_data_events`, `telemetry_samples` | the SDK's account export/deletion receipts and request telemetry (pruned after 14 days) | `0001_initial.sql` |

## Does not own

- **Live, Rent and AI** — OpenVibe.Live, OpenVibe.Rent and OpenVibe.AI. Tours reads their public APIs and never
  writes to them. It never uses a service token.
- **Identity and roles** — OpenVibe.Network. Tours is OAuth client `tours` (PKCE S256) and verifies session tokens
  against the Network JWKS; a person's canonical subject is `usr_…`.
- **OpenStreetMap, Wikivoyage, Wikidata, Commons** — external open data, cached in Tours' own tables with the source
  URL and the time fetched; never scraped past their terms.
- **Events, host and database** — OpenVibe.Events, OpenVibe.Host.

## Sources, licences and fetch times

| Source | Used for | Licence / terms | Kept |
|---|---|---|---|
| OpenStreetMap via Overpass | places (`tourism=*`) | ODbL 1.0; contact User-Agent, per-host pacing, one bounded `around:` query, no bulk download | OSM object URL, fetched time |
| Wikivoyage | city summary, See listings, route stops | CC BY-SA 4.0; the page URL on every city and stop | page URL, fetched time |
| Wikidata | coordinates, population, country, English Wikivoyage sitelink | CC0 | Q id, fetched time |
| Wikimedia Commons | city image + licence/credit | each image's own licence (usually CC BY-SA) | credit, licence, licence URL |
| OpenVibe.Live | live IRL streams, VODs, clips | public API; read-only | item URL, fetched time |
| OpenVibe.Rent | stays | public listings; read-only | listing URL, fetched time |

OpenVibe.AI is **not** used: its public API has chat, generate, summarize, classify, extract, embed, image and
research, but no speech synthesis. The route schema has `audio_status`/`audio_url` ready for the day it does.

## Jobs

Each source has its own job in `server/jobs/`, and each writes a receipt in `tours_job_runs` (status, counts, error).
They are off under `TOURS_DRILL`; production starts them after listen and refreshes on their own interval.

| Job | Fills | Default interval | Env |
|---|---|---|---|
| `cities` | 100 cities, their Wikidata/Commons image and Wikivoyage page + See lists | 24 h | `TOURS_CITIES_INTERVAL_MS`, `TOURS_CITY_LIMIT`, `TOURS_WIKIVOYAGE_DISTRICTS` |
| `places` | Wikivoyage See places for every city, then Overpass `tourism=*` for the 10 cities whose OSM data is oldest | 7 d | `TOURS_PLACES_INTERVAL_MS`, `TOURS_OSM_RADIUS_M`, `TOURS_OSM_MAX_PER_CITY`, `TOURS_OSM_CITIES_PER_RUN` |
| `routes` | up to two cited self-guided routes per city from the See lists | 7 d | `TOURS_ROUTES_INTERVAL_MS` |
| `live` | IRL streams now, recent IRL VODs/clips | 2 min | `TOURS_LIVE_INTERVAL_MS` |
| `stays` | Rent listings for the city | 6 h | `TOURS_STAYS_INTERVAL_MS` |

`npm run seed` runs them outside the server; the first run's counts are in the report and in `tours_job_runs`.
The first local seed (2026-10-31) stored **100 cities**, **2,714 places** (2,406 Wikivoyage + 308 OpenStreetMap across
10 cities), **180 routes / 1,239 cited stops** (96 cities), **23 IRL VODs + 1 clip**, and **0 stays** (Rent had no
active listing; the shelf says so). Live had no stream at that moment.
A failed source leaves the previous rows alone and is reported honestly; a city with fewer than four cited stops
with coordinates gets no invented route.

## API

Everything is JSON under `/api/v1`; errors are `application/problem+json` with a stable code. A person is the
`tours_at` session cookie or `Authorization: Bearer <Network user token>`, verified offline with the Network JWKS.
A write made with the session cookie must come from `https://openvibe.tours` (`403 tours.cross_site`). No route
needs a service token.

| Route | What it does |
|---|---|
| `GET /api/v1/cities?limit=&offset=&q=` | the top cities, population first, with place/route counts |
| `GET /api/v1/cities/:slug` | one city with its places, routes, live tours and stays |
| `GET /api/v1/places/:id` | one place and the routes it is on |
| `GET /api/v1/routes/:id` | one route with its ordered, cited stops |
| `GET /api/v1/live` | IRL tours now, recent IRL VODs and clips |
| `GET /api/v1/openapi.json` | the OpenAPI 3.1 document |
| `GET /api/v1/trips` | the signed-in person's trips |
| `POST /api/v1/trips` | create `{ title, city_slug, starts_on, ends_on, notes?, visibility? }` |
| `GET /api/v1/trips/:slug` | own trip, or a shared one read-only |
| `PATCH /api/v1/trips/:slug` | edit title, city, dates, notes or visibility |
| `DELETE /api/v1/trips/:slug` | delete the trip (204) |
| `POST /api/v1/trips/:slug/places` | save a place `{ place_id, note? }` |
| `DELETE /api/v1/trips/:slug/places/:placeId` | remove it |
| `POST /api/v1/trips/:slug/route` | set/clear the route `{ route_id }` (must be in the trip's city) |
| `POST /api/v1/trips/:slug/stays` | add a stay `{ stay_id }` |
| `DELETE /api/v1/trips/:slug/stays/:stayId` | remove it |

Validation refusals are `400 tours.invalid` or `400 tours.trip.invalid`; other codes: `tours.sign_in_required`,
`tours.person_required`, `tours.cross_site`, `tours.city_not_found`, `tours.place_not_found`,
`tours.route_not_found`, `tours.trip_not_found`, `tours.trip_owner`, `tours.rate_limited`.

## Pages

Server-rendered through the OpenVibe Frame (`openvibe-shared/shell`) and the room kit, readable without JavaScript.
Public pages are `public, max-age=60` with `Vary: Cookie`; a page drawn for a signed-in person or a private trip is
`private, no-store`; a shared trip is public and read-only. Ids and classes start with `tr-`.

| Page | What it is |
|---|---|
| `/` | the room: hero, live tours now, place of the day, top cities, routes, stays, scenes, FAQ, developers |
| `/cities` | the catalogue with a search box |
| `/city/:slug` | summary, image licence, places, routes, live, stays and a trip/ flight start |
| `/place/:id` | a place, its facts, OSM link, source, routes it is on, and save-to-trip |
| `/routes`, `/routes/:id` | the route list; one route with its map, stops, citations and audio note |
| `/live`, `/stays` | IRL tours now/VODs/clips; Rent stays with add-to-trip |
| `/flights` | the form that links the official airline-neutral search; the provider note |
| `/trips`, `/trips/new`, `/trips/:slug` | a person's trips; create; view/edit/share/delete |
| `/developers` | the API table, OpenAPI link, sources and job receipts |
| `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/llms-full.txt` | discovery; trips and the API are excluded |

The route map is MapLibre + OSM raster tiles from a CDN, loaded only on a route page; the same page always has the
numbered SVG map and every stop in text. `public/css/tours.css` is a working layout, not the final design: the
orchestrator designs every page.

## Sign-in, trips and privacy

A trip belongs to one Network `usr_…` subject. Only the owner can change it; a shared trip is readable by anyone
with the link and editable only by the owner; a private trip is a 404 to anyone else. The share slug is random, not
sequential. Account export returns the person's trips; account deletion erases the trips and everything saved on
them (`server/identity/account-data.js`). No table holds a token, and `/auth/me` never returns one.

## Run and test

```sh
npm install --include=dev
npm test                    # PGlite, fixtures, no network; 10 files
npm run test:pg             # the same through PostgreSQL + PgBouncer
npm run seed                # the real sources into data/pglite (development)
TOURS_CITY_LIMIT=10 npm run seed
npm start                   # PORT 5170, loopback; DATABASE_URL or embedded PGlite in development
```

The tests cover the migration and its constraints; every source parser and job against fixture sources (including
the Commons licence, OSM User-Agent, stable ids and idempotent reruns); the flights URL and no-affiliate rule; the
accent's AA contrast in both themes; every API route and its refusals; the full trip CRUD and sharing rules; pages
and their TouristTrip/TouristAttraction JSON-LD; sign-in with PKCE and session rules; and discovery.

## Deploy

`deploy/systemd/openvibe-tours.service` and `deploy/nginx/openvibe.tours.conf` are Meme's files with the names and
port changed (5170, `/etc/openvibe/tours.env`, `/opt/openvibe.tours`); the forms zone covers `/trips`. The
`.gitignore` is Meme's exact file. Not deployed by this change: the orchestrator creates the repo, the Contracts
manifest, the Network client and the host.

## Accent

Room id `tours` in `openvibe-shared/rooms`: dark `#F98942` on `#0B0D12` is **8.04:1** and light `#AA3900` on white is
**6.37:1** — AA in both themes (tested in `test/accent.test.js`).

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

<!-- versions:start -->
- openvibe-contracts: v0.265.0
- openvibe-sdk: v0.70.0
- openvibe-shared: v4.81.0
<!-- versions:end -->
