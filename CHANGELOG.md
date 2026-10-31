# Changelog

## 0.1.0 — 2026-10-31

- The top 100 cities from Wikidata and Wikivoyage, places from OpenStreetMap `tourism=*`, and a place of the day.
- City and place pages with every source and fetch time; TouristDestination, TouristAttraction and TouristTrip JSON-LD.
- Self-guided routes generated from Wikivoyage See lists, marked as generated, cited stop by stop, on a MapLibre + OSM map.
- IRL tours now, recent IRL VODs and clips from OpenVibe.Live's public list; stays from OpenVibe.Rent's public listings.
- A flight form that links the official airline-neutral search with the city pair, no affiliate; Duffel/Kiwi off without an adapter.
- Trips for a signed-in person: city, dates, saved places, one route, stays; shareable read-only; owner-only edit and delete.
- `GET /api/v1/cities`, `/cities/:slug`, `/places/:id`, `/routes/:id`, `/live`, trips CRUD, and an OpenAPI 3.1 document.
- Source jobs with receipts (`tours_job_runs`), off under `TOURS_DRILL`; Network sign-in with PKCE; account deletion.
- Server-rendered home with the room kit; anchor accent `#F98942` dark / `#AA3900` light (AA in both themes).
