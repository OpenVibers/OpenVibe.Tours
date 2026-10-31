# Security

Report a vulnerability to security@openvibe.network, not in a public issue.

- **Tokens.** The Network access and refresh tokens live only in httpOnly cookies (`tours_at`, `tours_rt`); the flow
  state and PKCE verifier in `tours_oauth` (httpOnly, path `/auth`, 10 minutes). No token is stored in the database,
  rendered in a page or logged. `/auth/me` never returns one.
- **Sessions.** A session token is a Network user token with audience `openvibe.network`; FedCM assertions, app and
  service tokens are refused. A write made with the session cookie must come from `https://openvibe.tours` itself
  (`403 tours.cross_site`).
- **Trips.** A trip is the owner's Network `usr_…` subject; a private trip is a 404 to anyone else, a shared one is
  read-only, and the share slug is random. Account deletion cascades.
- **Outbound.** The source jobs fetch only the fixed public hosts in `server/config.js` (OpenVibe.Live/Rent,
  Wikivoyage, Wikidata, Wikipedia, Commons, Overpass). No user-chosen URL is fetched. The flight form is a link, not
  a fetch, and has no affiliate parameter.
- **Open data.** Overpass gets a contact User-Agent, one bounded query per city, a per-host pace and no bulk
  download. Keys are never needed for a source; a key that is not implemented stays off.
- **Deploy.** `User=ubuntu`, loopback only, `/internal` and `/metrics` are 404 at nginx, and request bodies are
  never logged.
