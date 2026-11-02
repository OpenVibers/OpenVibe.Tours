'use strict';

/**
 * Tours' server-rendered pages. They work without JavaScript: every link is real, every action is a plain form.
 * Public pages are public, max-age=60 with Vary: Cookie; a page drawn for a signed-in person or a private trip is
 * private, no-store. The route page adds a MapLibre map from a CDN on top of the complete stop list and its SVG.
 *
 * Ids and classes start with `tr-`.
 */
const { esc, raw } = require('../render/html');
const sc = require('openvibe-shared/showcase');
const kit = require('openvibe-shared/kit');
const { stateLabel } = require('./labels');

const SOURCE = {
    osm: '<a href="https://www.openstreetmap.org/copyright" rel="noopener">© OpenStreetMap contributors</a>, ODbL 1.0',
    wikivoyage: '<a href="https://en.wikivoyage.org" rel="noopener">Wikivoyage</a>, CC BY-SA 4.0',
    wikidata: '<a href="https://www.wikidata.org" rel="noopener">Wikidata</a>, CC0',
};

const day = (iso) => (iso ? esc(String(iso).slice(0, 10)) : '—');
const when = (iso) => (iso ? esc(String(iso).replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC')) : '—');
const km = (m) => (Number(m) >= 1000 ? `${(Number(m) / 1000).toFixed(1)} km` : `${Math.round(Number(m) || 0)} m`);
const safeHttp = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);
// A picture is drawn only from a URL that is one: Commons, or a path ending in an image type. A Wikivoyage listing's
// image field sometimes holds a share link (photos.app.goo.gl), which drew a broken image on the home (2026-11-01).
const safeImage = (v) => {
    const u = safeHttp(v);
    if (!u) return null;
    try {
        const { hostname, pathname } = new URL(u);
        return /(^|\.)wikimedia\.org$/i.test(hostname) || /\.(jpe?g|png|webp|gif|avif|svg)$/i.test(pathname) ? u : null;
    } catch { return null; }
};
const money = (n, c) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${c}`;
const pct = (n, total) => (total ? Math.round((Number(n) / Number(total)) * 100) : 0);

function empty(text, href = null, label = '') {
    return `<div class="tr-empty"><p>${esc(text)}</p>${href ? `<a class="tr-btn tr-btn-quiet" href="${esc(href)}">${esc(label)}</a>` : ''}</div>`;
}

function note(html, kind = 'info') {
    return `<p class="tr-note tr-note-${esc(kind)}" role="${kind === 'error' ? 'alert' : 'status'}">${html}</p>`;
}

/** The hero's drawing: a plane's dotted arc landing on a map, then the walking route. */
function heroMotif() {
    return `<div class="tr-vis" aria-hidden="true">
<svg viewBox="0 0 420 320" class="tr-vis-svg">
<defs><linearGradient id="tr-arc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--room-accent,#F98942)"/><stop offset="1" stop-color="var(--accent-light,#60a5fa)"/></linearGradient></defs>
<path class="tr-grid" d="M0 60 H420 M0 150 H420 M0 240 H420 M70 0 V320 M210 0 V320 M350 0 V320"/>
<path class="tr-arc" d="M28 250 Q150 40 330 92" fill="none" stroke="url(#tr-arc)" stroke-width="3" stroke-dasharray="7 8"/>
<circle class="tr-land" cx="330" cy="92" r="8"/>
<path class="tr-walk" d="M92 230 L150 200 L188 224 L238 178 L292 194 L318 158" fill="none" stroke="var(--room-accent,#F98942)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
${[[92, 230], [150, 200], [188, 224], [238, 178], [292, 194], [318, 158]].map(([x, y], i) => `<g><circle cx="${x}" cy="${y}" r="${i ? 6 : 9}" class="tr-pin"/><text x="${x}" y="${y + 4}" text-anchor="middle" class="tr-pin-n">${i + 1}</text></g>`).join('')}
</svg>
<span class="tr-vis-badge">fly · stay · walk · watch</span></div>`;
}

const cityCard = (c) => kit.card({
    href: `/city/${c.slug}`,
    title: c.name,
    type: 'map',
    image: safeImage(c.image_url) || '',
    alt: c.image_credit ? `${c.name} (${c.image_credit})` : c.name,
    badge: c.country || '',
    who: c.country || '',
    count: [Number(c.place_count) || 0, Number(c.place_count) === 1 ? 'place' : 'places'],
    peek: c.summary ? String(c.summary).slice(0, 120) : '',
    level: 3,
});

const placeCard = (p) => kit.card({
    href: `/place/${p.id}`,
    title: p.name,
    type: 'map',
    image: safeImage(p.image_url) || '',
    badge: p.kind ? p.kind.replace(/_/g, ' ') : '',
    who: p.city_name || '',
    peek: p.description ? String(p.description).slice(0, 120) : '',
    level: 3,
});

const routeCard = (r) => kit.card({
    href: `/routes/${r.id}`,
    title: r.title,
    type: 'map',
    badge: r.generated ? 'Wikivoyage' : '',
    who: r.city_name || '',
    count: [Number(r.stop_count) || 0, Number(r.stop_count) === 1 ? 'stop' : 'stops'],
    corner: `${km(r.distance_m)} · ${Number(r.duration_min) || 0} min`,
    peek: r.summary ? String(r.summary).slice(0, 140) : '',
    level: 3,
});

const liveCard = (l) => kit.card({
    href: l.url,
    title: l.title,
    type: 'stream',
    image: safeHttp(l.thumbnail_url) || '',
    live: l.kind === 'stream',
    badge: l.kind === 'clip' ? 'CLIP' : l.kind === 'vod' ? 'VOD' : '',
    who: l.display_name || l.username,
    count: l.kind === 'stream' ? [Number(l.viewer_count) || 0, 'watching'] : null,
    when: l.started_at || l.ended_at,
    peek: l.city_name ? `In ${l.city_name}` : '',
    level: 3,
});

const stayCard = (s) => kit.card({
    href: s.url,
    title: s.title,
    type: 'listing',
    badge: String(s.kind || '').replace(/_/g, ' '),
    who: s.city_name,
    corner: `${money(s.price, s.currency)} / ${s.period}`,
    peek: s.neighbourhood || '',
    level: 3,
});

// Cut at a word, with an ellipsis: never half a word ("was built at Dnyan").
const clip = (s, n) => { const t = String(s || '').trim(); if (t.length <= n) return t; const cut = t.slice(0, n); const at = cut.lastIndexOf(' '); return `${(at > n * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:·-]+$/, '')}…`; };

function placeOfDayCard(p) {
    if (!p) return '';
    return `<article class="tr-pod" data-place="${esc(p.id)}">
<a class="tr-pod-link" href="/place/${esc(p.id)}">
${safeImage(p.image_url) ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy" decoding="async">` : '<span class="tr-pod-noimg" aria-hidden="true">◆</span>'}
<span class="tr-pod-body"><span class="tr-kicker">Place of the day · ${esc(p.city_name || '')}</span><strong>${esc(p.name)}</strong>
<span class="tr-muted">${esc(p.kind ? p.kind.replace(/_/g, ' ') : 'place')}${p.description ? ` · ${esc(clip(p.description, 150))}` : ''}</span></span>
</a></article>`;
}

function home({ counts = {}, live = [], recent = [], placeOfDay = null, cities = [], routes = [], stays = [], jobs = [] } = {}) {
    const rails = [
        // Real first (the owner, 10-31): live tours when someone is live, else the recordings; never an empty rail.
        live.length ? { id: 'tr-live', title: 'Live tours now', more: { href: '/live', label: 'All live tours' }, items: live.map(liveCard), size: 'm' } : null,
        !live.length && recent.length ? { id: 'tr-recent', title: 'Recent IRL recordings and clips', more: { href: '/live', label: 'All live tours' }, items: recent.map(liveCard), size: 'm' } : null,
        placeOfDay ? { id: 'tr-place-of-day', title: 'Place of the day', items: [placeOfDayCard(placeOfDay)], size: 'l' } : null,
        cities.length ? { id: 'tr-cities', title: 'Top cities', more: { href: '/cities', label: 'All cities' }, items: cities.map(cityCard), size: 'm' } : null,
        routes.length ? { id: 'tr-routes', title: 'Self-guided routes', more: { href: '/routes', label: 'All routes' }, items: routes.map(routeCard), size: 'm' } : null,
        stays.length ? { id: 'tr-stays', title: 'Stays', more: { href: '/stays', label: 'All stays' }, items: stays.map(stayCard), size: 'm' } : null,
    ].filter(Boolean);
    const lastFetch = jobs.map((j) => j.finished_at).filter(Boolean).sort().pop();
    const proof = [
        Number(counts.cities) ? { value: Number(counts.cities), label: 'cities' } : null,
        Number(counts.places) ? { value: Number(counts.places), label: 'places' } : null,
        Number(counts.routes) ? { value: Number(counts.routes), label: 'walking routes' } : null,
        Number(counts.live) ? { value: Number(counts.live), label: 'live now', live: true } : null,
    ].filter(Boolean);
    const room = sc.room({
        room: 'tours',
        hero: {
            title: 'Go anywhere: fly, stay, walk, watch',
            lede: 'Places from OpenStreetMap, notes from Wikivoyage, coordinates and pictures from Wikidata, IRL tours live on OpenVibe.Live, stays from OpenVibe.Rent, and a map for every walk. All open data, each with its source and fetch time.',
            search: { action: '/cities', name: 'q', placeholder: 'A city: Lisbon, Tokyo, Mexico City…', hints: ['Lisbon', 'Tokyo', 'Mexico City', 'Barcelona'], label: 'Find a city' },
            chips: [{ label: 'Live tours', href: '/live' }, { label: 'Routes', href: '/routes' }, { label: 'Stays', href: '/stays' }, { label: 'Flights', href: '/flights' }],
            proof,
            motif: heroMotif(),
        },
        rails,
        scenes: [
            {
                title: 'Walk a city with a cited note at every stop',
                text: 'A route is ordered stops on a map, generated from Wikivoyage\'s See lists and marked as generated. Every stop links the Wikivoyage page it came from, the OpenStreetMap place it matches, and its coordinates.',
                html: `<div class="tr-demo-walk"><span class="tr-demo-stop">1 · Castelo de São Jorge</span><span class="tr-demo-line"></span><span class="tr-demo-stop">2 · Lisbon Cathedral</span><span class="tr-demo-line"></span><span class="tr-demo-stop">3 · Miradouro de Santa Luzia</span><small>Wikivoyage CC BY-SA · OpenStreetMap ODbL</small></div>`,
                action: { href: '/routes', label: 'Find a walk' },
            },
            {
                title: 'Watch a real place, now',
                text: 'Live tours are IRL streams from OpenVibe.Live\'s public stream list, with the viewer count and the city when the title or tags name one. Recorded IRL tours link to their VOD and clips to openvibe.video. Tours never posts to Live or chat.',
                html: `<div class="tr-demo-live"><span class="tr-live-dot"></span><b>Live now</b><span>Category IRL · OpenVibe.Live</span><small>No follow, no write, no token.</small></div>`,
                action: { href: '/live', label: 'Watch live tours' },
            },
            {
                title: 'Build a trip and share it read-only',
                text: 'Sign in with OpenVibe, pick a city and dates, save places, add a route and a stay, then share the link. Only you can edit it; anyone with the link can read it. Group voting is not in v1.',
                html: `<div class="tr-demo-trip"><span class="tr-trip-day">Fri</span><b>Land · check in</b><span class="tr-trip-day">Sat</span><b>Walk the See list</b><span class="tr-trip-day">Sun</span><b>Market, then home</b><small>Private by default · shared on purpose</small></div>`,
                action: { href: '/trips/new', label: 'Plan a trip' },
            },
        ],
        explore: {
            title: 'What a trip is made of',
            items: [
                { title: 'Cities', text: 'The top 100 first, from Wikidata coordinates and Wikivoyage pages.', href: '/cities', icon: 'map' },
                { title: 'Places', text: 'Tourism=* from OpenStreetMap, with the OSM link and fetch time.', href: '/cities', icon: 'pin' },
                { title: 'Live tours', text: 'IRL streams now and recent VODs from OpenVibe.Live.', href: '/live', icon: 'live' },
                { title: 'Stays', text: 'Rentals from OpenVibe.Rent; no payment is handled here.', href: '/stays', icon: 'home' },
                { title: 'Flights', text: 'No key yet: a form opens the official airline-neutral search.', href: '/flights', icon: 'plane' },
                { title: 'Trips', text: 'A city, dates, saved places, a route and stays — shareable read-only.', href: '/trips', icon: 'calendar' },
            ],
        },
        dev: {
            title: 'The API',
            lede: 'Everything the pages show is JSON under /api/v1, with an OpenAPI document. A trip write is a signed-in person; a public read needs no token.',
            samples: [
                { label: 'Cities', lang: 'bash', code: 'curl https://openvibe.tours/api/v1/cities\ncurl https://openvibe.tours/api/v1/cities/lisbon' },
                { label: 'Places and routes', lang: 'bash', code: 'curl https://openvibe.tours/api/v1/places/plc_…\ncurl https://openvibe.tours/api/v1/routes/rte_…' },
                { label: 'Live', lang: 'bash', code: 'curl https://openvibe.tours/api/v1/live' },
                { label: 'OpenAPI', lang: 'json', code: 'GET /api/v1/openapi.json' },
            ],
        },
        faq: {
            items: [
                ['Where does the data come from?', 'OpenStreetMap (Overpass, tourism=*) under ODbL, Wikivoyage under CC BY-SA, Wikidata under CC0, OpenVibe.Live\'s public stream list and OpenVibe.Rent\'s public listings. Every city, place, route and source row shows its source and fetch time.'],
                ['Are the routes real guided tours?', 'No. They are self-guided walks generated from Wikivoyage\'s See lists and marked as generated. Check opening hours and access before you go; the note at each stop is the Wikivoyage text, cited.'],
                ['Do you sell flights or stays?', 'No. There is no flight API key in v1: the flight form opens the official airline-neutral search with the city pair filled in, with no affiliate parameter. Stays link to the listing on OpenVibe.Rent; Tours never takes a payment.'],
                ['Is there audio on the stops?', 'Not yet. OpenVibe.AI has no speech-synthesis route today, so every stop says audio is off instead of shipping a broken player. The audio fields are in the schema for when an API exists.'],
                ['Who can see my trip?', 'Only you, until you switch it to shared. A shared trip is readable by anyone with its link and editable only by you. Delete it at any time; account deletion erases your trips.'],
                ['Why is a city missing?', 'The v1 catalogue is the top 100 cities by population; every city is fetched from Wikidata and Wikivoyage. A failed source run leaves the previous data and says so in the job receipt rather than inventing a place.'],
            ],
        },
    });
    const jobsLine = jobs.length
        ? `<section class="tr-sec tr-sources" aria-labelledby="tr-sources-h"><h2 id="tr-sources-h">Sources and fetch times</h2><p class="tr-muted">${esc(SOURCE.osm.replace(/<[^>]+>/g, ''))} · Wikivoyage CC BY-SA 4.0 · Wikidata CC0 · OpenVibe.Live · OpenVibe.Rent. Last source run ${lastFetch ? when(lastFetch) : 'not yet'}.</p><ul class="tr-jobs">${jobs.map((j) => `<li><b>${esc(j.job)}</b> ${esc(stateLabel(j.status))}${j.finished_at ? ` · ${when(j.finished_at)}` : ''}${j.error ? ` · ${esc(String(j.error).slice(0, 200))}` : ''}</li>`).join('')}</ul></section>`
        : '';
    return `<div class="tr-wrap tr-home" id="tr-home">${room}${jobsLine}</div>`;
}

function citiesPage({ cities = [], q = '' } = {}) {
    return `<div class="tr-wrap" id="tr-cities-page">
<header class="tr-page-h"><p class="tr-kicker">Cities</p><h1>The top 100, from open data</h1>
<p class="tr-lede">Coordinates and population from Wikidata, the page and its See list from Wikivoyage, places from OpenStreetMap. A city page lists its places, routes, live tours and stays.</p>
<form class="tr-form tr-form-inline" method="get" action="/cities" role="search"><label class="tr-field"><span>Find a city</span><input type="search" name="q" value="${esc(q)}" maxlength="80" placeholder="Lisbon"></label><button class="tr-btn" type="submit">Search</button></form></header>
${cities.length ? `<ol class="tr-city-list">${cities.map((c) => `<li class="tr-city-row"><a href="/city/${esc(c.slug)}">
<span class="tr-city-photo">${safeImage(c.image_url) ? `<img src="${esc(c.image_url)}" alt="" loading="lazy" decoding="async">` : '<span aria-hidden="true">◆</span>'}</span>
<span class="tr-city-text"><strong>${esc(c.name)}</strong><span class="tr-muted">${esc(c.country)}${c.population ? ` · ${Number(c.population).toLocaleString('en-US')} people` : ''}</span>
<span class="tr-muted">${Number(c.place_count) || 0} places · ${Number(c.route_count) || 0} routes</span></span></a></li>`).join('')}</ol>` : empty('No city matched that search.', '/cities', 'See all cities')}
<p class="tr-fine">${SOURCE.wikidata} · ${SOURCE.wikivoyage} · ${SOURCE.osm}</p>
</div>`;
}

function cityPage({ city, places = [], routes = [], live = [], stays = [] } = {}) {
    const img = safeImage(city.image_url);
    return `<div class="tr-wrap" id="tr-city-page">
<header class="tr-page-h tr-city-head">
<p class="tr-kicker">${esc(city.country)}${city.region ? ` · ${esc(city.region)}` : ''}</p>
<h1>${esc(city.name)}</h1>
${city.summary ? `<p class="tr-lede">${esc(city.summary)}</p>` : note('No Wikivoyage summary was fetched for this city yet.', 'warn')}
<p class="tr-fine">${city.population ? `${Number(city.population).toLocaleString('en-US')} people · ` : ''}<a href="https://www.openstreetmap.org/?mlat=${city.lat}&mlon=${city.lon}#map=11/${city.lat}/${city.lon}" rel="noopener">Map</a> · <a href="${esc(city.source_url)}" rel="noopener">${esc(city.source === 'wikivoyage' ? 'Wikivoyage' : 'Wikidata')}</a> · fetched ${when(city.fetched_at)}</p>
${img ? `<figure class="tr-city-img"><img src="${esc(img)}" alt="${esc(city.name)}" loading="lazy" decoding="async"><figcaption>${esc(city.image_credit || 'Wikimedia Commons')}${city.image_license ? ` · ${esc(city.image_license)}` : ''}${city.image_license_url ? ` · <a href="${esc(city.image_license_url)}" rel="noopener">licence</a>` : ''}</figcaption></figure>` : ''}
</header>
${routes.length ? `<section class="tr-sec"><div class="tr-sec-head"><h2>Self-guided routes</h2><span class="tr-muted">generated from Wikivoyage's See list</span></div><ol class="tr-route-list">${routes.map((r) => `<li><a href="/routes/${esc(r.id)}"><strong>${esc(r.title)}</strong><span class="tr-muted">${Number(r.stop_count)} stops · ${km(r.distance_m)} · ${Number(r.duration_min)} min</span></a></li>`).join('')}</ol></section>` : ''}
<section class="tr-sec" id="tr-city-places"><div class="tr-sec-head"><h2>Places</h2><a class="tr-more" href="https://www.openstreetmap.org/?mlat=${city.lat}&mlon=${city.lon}#map=13/${city.lat}/${city.lon}" rel="noopener">OpenStreetMap</a></div>
${places.length ? `<ol class="tr-place-list">${places.map((p) => `<li class="tr-place-row"><a href="/place/${esc(p.id)}"><strong>${esc(p.name)}</strong><span class="tr-muted">${esc(String(p.kind || '').replace(/_/g, ' '))}${p.address ? ` · ${esc(p.address)}` : ''}${p.wheelchair === 'yes' ? ' · step-free' : ''}${p.fee === 'no' ? ' · free' : ''}</span></a></li>`).join('')}</ol>` : empty('No OpenStreetMap place was stored for this city yet. The places job fills it.', '/cities', 'Another city')}
<p class="tr-fine">${SOURCE.osm}</p></section>
${live.length ? `<section class="tr-sec"><div class="tr-sec-head"><h2>Live tours and recordings</h2><a class="tr-more" href="/live">All live</a></div><ol class="tr-live-list">${live.map((l) => `<li><a href="${esc(l.url)}" rel="noopener"><strong>${esc(l.title)}</strong><span class="tr-muted">${esc(l.kind === 'stream' ? 'Live now' : l.kind === 'clip' ? 'Clip' : 'Recording')} · ${esc(l.display_name || l.username)}${l.city_name ? ` · ${esc(l.city_name)}` : ''}${l.kind === 'stream' ? ` · ${Number(l.viewer_count)} watching` : ''}</span></a></li>`).join('')}</ol><p class="tr-fine">OpenVibe.Live's public stream list · fetched ${when(live[0].fetched_at)}</p></section>` : ''}
${stays.length ? `<section class="tr-sec"><div class="tr-sec-head"><h2>Stays</h2><a class="tr-more" href="/stays">All stays</a></div><ol class="tr-stay-list">${stays.map((s0) => `<li><a href="${esc(s0.url)}" rel="noopener"><strong>${esc(s0.title)}</strong><span class="tr-muted">${esc(s0.kind)} · ${money(s0.price, s0.currency)} / ${esc(s0.period)}${s0.neighbourhood ? ` · ${esc(s0.neighbourhood)}` : ''}</span></a></li>`).join('')}</ol><p class="tr-fine">OpenVibe.Rent's public listings · never a payment on Tours.</p></section>` : ''}
<section class="tr-sec"><div class="tr-sec-head"><h2>Plan a trip here</h2></div><p class="tr-muted">Sign in, pick dates, save places from this city and add a route and a stay.</p><p><a class="tr-btn" href="/trips/new?city=${encodeURIComponent(city.slug)}">Start a trip in ${esc(city.name)}</a> <a class="tr-btn tr-btn-quiet" href="/flights?to=${encodeURIComponent(city.name)}">Find a flight</a></p></section>
</div>`;
}

function placePage({ place, routeList = [], trips = [] } = {}) {
    return `<div class="tr-wrap" id="tr-place-page">
<nav class="crumbs" aria-label="Breadcrumbs"><a href="/cities">Cities</a> / <a href="/city/${esc(place.city_slug)}">${esc(place.city_name)}</a></nav>
<header class="tr-page-h"><p class="tr-kicker">${esc(String(place.kind || '').replace(/_/g, ' '))}</p><h1>${esc(place.name)}</h1>
<p class="tr-lede">${esc(place.description || `${place.name} in ${place.city_name}, from OpenStreetMap.`)}</p>
<p class="tr-fine">${place.osm_url ? `<a href="${esc(place.osm_url)}" rel="noopener">OpenStreetMap ${esc(place.osm_type)} ${esc(place.osm_id)}</a> · ` : ''}<a href="${esc(place.source_url)}" rel="noopener">${esc(place.source === 'wikivoyage' ? 'Wikivoyage' : 'source')}</a> · fetched ${when(place.fetched_at)}${place.wikidata_id ? ` · <a href="https://www.wikidata.org/wiki/${esc(place.wikidata_id)}" rel="noopener">Wikidata</a>` : ''}</p></header>
${safeImage(place.image_url) ? `<figure class="tr-place-img"><img src="${esc(place.image_url)}" alt="${esc(place.name)}" loading="lazy" decoding="async"><figcaption>${esc(place.image_credit || 'OpenStreetMap contributor')}${place.image_license ? ` · ${esc(place.image_license)}` : ''}</figcaption></figure>` : ''}
<dl class="tr-facts">
${place.address ? `<div><dt>Address</dt><dd>${esc(place.address)}</dd></div>` : ''}
${place.opening_hours ? `<div><dt>Opening hours</dt><dd>${esc(place.opening_hours)}</dd></div>` : ''}
${place.wheelchair ? `<div><dt>Step-free</dt><dd>${esc(place.wheelchair)}</dd></div>` : ''}
${place.fee ? `<div><dt>Fee</dt><dd>${esc(place.fee)}</dd></div>` : ''}
<div><dt>Coordinates</dt><dd>${Number(place.lat).toFixed(5)}, ${Number(place.lon).toFixed(5)} · <a href="${esc(place.map_url)}" rel="noopener">map</a></dd></div>
${safeHttp(place.website) ? `<div><dt>Website</dt><dd><a href="${esc(place.website)}" rel="nofollow noopener">${esc(place.website)}</a></dd></div>` : ''}
</dl>
${routeList.length ? `<section class="tr-sec"><div class="tr-sec-head"><h2>On these routes</h2></div><ol class="tr-route-list">${routeList.map((r) => `<li><a href="/routes/${esc(r.id)}"><strong>${esc(r.title)}</strong><span class="tr-muted">${esc(r.city_name)} · ${Number(r.stop_count)} stops</span></a></li>`).join('')}</ol></section>` : ''}
${trips.length ? `<section class="tr-sec"><div class="tr-sec-head"><h2>Save it to a trip</h2></div><form class="tr-form tr-form-inline" method="post" action="/trips/${esc(trips[0].slug)}/places"><input type="hidden" name="place_id" value="${esc(place.id)}"><label class="tr-field"><span>Trip</span><select name="trip">${trips.map((t) => `<option value="${esc(t.slug)}">${esc(t.title)}</option>`).join('')}</select></label><label class="tr-field"><span>Note (optional)</span><input name="note" maxlength="500"></label><button class="tr-btn" type="submit">Save place</button></form></section>` : `<section class="tr-sec"><p class="tr-muted"><a href="/auth/login?next=${encodeURIComponent(`/place/${place.id}`)}">Sign in</a> to save this place to a trip.</p></section>`}
<p class="tr-fine">${SOURCE.osm}</p>
</div>`;
}

function miniMap(stops, label) {
    const pts = (stops || []).filter((s) => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)));
    if (!pts.length) return '';
    const lats = pts.map((p) => Number(p.lat)); const lons = pts.map((p) => Number(p.lon));
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats); const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
    const x = (lon) => 20 + ((lon - minLon) / (maxLon - minLon || 0.01)) * 560;
    const y = (lat) => 20 + ((maxLat - lat) / (maxLat - minLat || 0.01)) * 200;
    return `<figure class="tr-map-fallback" id="tr-map-fallback"><svg viewBox="0 0 600 240" role="img" aria-label="${esc(label)}">
<rect width="600" height="240" rx="14" class="tr-map-bg"/>
<path d="M0 80 H600 M0 160 H600 M120 0 V240 M300 0 V240 M480 0 V240" class="tr-map-grid"/>
${pts.length > 1 ? `<polyline points="${pts.map((p) => `${x(Number(p.lon)).toFixed(1)},${y(Number(p.lat)).toFixed(1)}`).join(' ')}" class="tr-path"/>` : ''}
${pts.map((p, i) => `<g><circle cx="${x(Number(p.lon)).toFixed(1)}" cy="${y(Number(p.lat)).toFixed(1)}" r="14" class="tr-pin"/><text x="${x(Number(p.lon)).toFixed(1)}" y="${(y(Number(p.lat)) + 5).toFixed(1)}" text-anchor="middle" class="tr-pin-n">${i + 1}</text></g>`).join('')}
</svg><figcaption>${pts.length} ${pts.length === 1 ? 'stop' : 'stops'} on the map. ${SOURCE.osm}</figcaption></figure>`;
}

function routePage({ route, trips = [] } = {}) {
    const stops = route.stops || [];
    const mapData = esc(JSON.stringify(stops.map((s, i) => ({ n: i + 1, title: s.title, lat: s.lat, lon: s.lon }))));
    return `<div class="tr-wrap" id="tr-route-page">
<nav class="crumbs" aria-label="Breadcrumbs"><a href="/cities">Cities</a> / <a href="/city/${esc(route.city_slug)}">${esc(route.city_name)}</a> / Route</nav>
<header class="tr-page-h"><p class="tr-kicker">Self-guided route · generated from Wikivoyage</p><h1>${esc(route.title)}</h1>
<p class="tr-lede">${esc(route.summary || '')}</p>
<p class="tr-fine">${Number(route.stop_count)} stops · ${km(route.distance_m)} · about ${Number(route.duration_min)} min on foot · <a href="${esc(route.source_url)}" rel="noopener">Wikivoyage source</a> · fetched ${when(route.fetched_at)}. Not a guided tour: check each place before you go.</p></header>
<div class="tr-map" id="tr-map" data-stops="${mapData}" data-label="${esc(route.title)}" data-osm-attribution="© OpenStreetMap contributors">
${miniMap(stops, `Map of ${route.title}`)}
<div id="tr-maplibre" class="tr-maplibre" hidden aria-label="Interactive map"></div>
</div>
<ol class="tr-stops">${stops.map((s) => `<li class="tr-stop" id="stop-${Number(s.position)}">
<span class="tr-stop-num" aria-hidden="true">${Number(s.position)}</span>
<div class="tr-stop-body"><h2>${esc(s.title)}</h2>
${s.note ? `<p>${esc(s.note)}</p>` : ''}
<p class="tr-fine">${esc(Number(s.lat).toFixed(5))}, ${esc(Number(s.lon).toFixed(5))} · <a href="${esc(s.map_url)}" rel="noopener">OpenStreetMap</a> · <a href="${esc(s.source_url)}" rel="noopener">Wikivoyage note</a>${s.place_id ? ` · <a href="/place/${esc(s.place_id)}">place page</a>` : ''}</p>
<p class="tr-audio tr-muted">Audio: not available${s.audio_status === 'ready' && s.audio_url ? ` · <a href="${esc(s.audio_url)}">listen</a>` : ' — OpenVibe.AI has no speech-synthesis API today'}.</p>
</div></li>`).join('')}</ol>
<section class="tr-sec"><div class="tr-sec-head"><h2>Use this route</h2></div>
${trips.length ? `<form class="tr-form tr-form-inline" method="post" action="/trips/${esc(trips[0].slug)}/route"><label class="tr-field"><span>Trip</span><select name="trip">${trips.map((t) => `<option value="${esc(t.slug)}">${esc(t.title)}</option>`).join('')}</select></label><input type="hidden" name="route_id" value="${esc(route.id)}"><button class="tr-btn" type="submit">Add to trip</button></form>` : `<p class="tr-muted"><a href="/auth/login?next=${encodeURIComponent(`/routes/${route.id}`)}">Sign in</a> to add this route to a trip.</p>`}
<p class="tr-fine">Notes and the ordering come from Wikivoyage, CC BY-SA 4.0; coordinates and map data from OpenStreetMap, ODbL. The route drawing is generated, not a guide's promise.</p></section>
</div>`;
}

function livePage({ live = [], recent = [] } = {}) {
    return `<div class="tr-wrap" id="tr-live-page">
<header class="tr-page-h"><p class="tr-kicker">Watch</p><h1>Live tours now</h1>
<p class="tr-lede">IRL streams on OpenVibe.Live whose public category or title is a real-world tour. A city is attached only when the title or tags name one; Live publishes no location. Recordings are recent IRL VODs. Tours reads the public list and never posts, follows or chats.</p></header>
${live.length ? `<ol class="tr-live-grid">${live.map((l) => `<li><a class="tr-live-card" href="${esc(l.url)}" rel="noopener">
${safeHttp(l.thumbnail_url) ? `<img src="${esc(l.thumbnail_url)}" alt="" loading="lazy" decoding="async">` : '<span class="tr-live-noimg" aria-hidden="true">●</span>'}
<span class="tr-live-live">LIVE</span><strong>${esc(l.title)}</strong><span class="tr-muted">${esc(l.display_name || l.username)}${l.city_name ? ` · ${esc(l.city_name)}` : ''} · ${Number(l.viewer_count)} watching</span></a></li>`).join('')}</ol>` : empty('No IRL tour is live on OpenVibe.Live right now. Recent recordings are below.', '/cities', 'Browse cities')}
${recent.length ? `<section class="tr-sec"><div class="tr-sec-head"><h2>Recent IRL recordings and clips</h2></div><ol class="tr-live-list">${recent.map((l) => `<li><a href="${esc(l.url)}" rel="noopener"><strong>${esc(l.title)}</strong><span class="tr-muted">${esc(l.display_name || l.username)}${l.city_name ? ` · ${esc(l.city_name)}` : ''}${l.ended_at ? ` · ended ${when(l.ended_at)}` : ''}</span></a></li>`).join('')}</ol></section>` : ''}
<p class="tr-fine">OpenVibe.Live · public stream list · fetched ${when((live[0] || recent[0] || {}).fetched_at)}</p>
</div>`;
}

function staysPage({ stays = [], trips = [] } = {}) {
    return `<div class="tr-wrap" id="tr-stays-page">
<header class="tr-page-h"><p class="tr-kicker">Stay</p><h1>Stays from OpenVibe.Rent</h1>
<p class="tr-lede">Active rentals on OpenVibe.Rent for the cities in the catalogue, with the city, the price and the period as the listing states them. Tours never handles a payment and never takes a booking fee.</p></header>
${stays.length ? `<ol class="tr-stay-grid">${stays.map((s0) => `<li><a class="tr-stay-card" href="${esc(s0.url)}" rel="noopener"><strong>${esc(s0.title)}</strong><span class="tr-muted">${esc(s0.city_name)}${s0.neighbourhood ? ` · ${esc(s0.neighbourhood)}` : ''}</span><span class="tr-price">${money(s0.price, s0.currency)} <small>/ ${esc(s0.period)}</small></span><span class="tr-muted">${esc(String(s0.kind).replace(/_/g, ' '))} · OpenVibe.Rent</span></a>${trips.length ? `<form class="tr-form tr-form-inline" method="post" action="/trips/${esc(trips[0].slug)}/stays"><input type="hidden" name="stay_id" value="${esc(s0.id)}"><label class="tr-field"><span>Trip</span><select name="trip">${trips.map((t0) => `<option value="${esc(t0.slug)}">${esc(t0.title)}</option>`).join('')}</select></label><button class="tr-btn tr-btn-quiet" type="submit">Add to trip</button></form>` : ''}</li>`).join('')}</ol>` : empty('OpenVibe.Rent has no active listing in these cities today, so the shelf is honestly empty. It fills as people post.', '/cities', 'Browse cities')}
<p class="tr-fine">Listings from <a href="https://openvibe.rent" rel="noopener">OpenVibe.Rent</a>'s public API, fetched ${when((stays[0] || {}).fetched_at)}. Never pay a deposit before you have seen the place and signed an agreement.</p>
</div>`;
}

function flightsPage({ values = {}, result = null, error = null, providers = {} } = {}) {
    const v = { from: '', to: '', depart: '', return: '', ...values };
    return `<div class="tr-wrap tr-narrow" id="tr-flights-page">
<header class="tr-page-h"><p class="tr-kicker">Fly</p><h1>Find a flight</h1>
<p class="tr-lede">There is no flight API key yet, so Tours does not invent a price. This form opens the official airline-neutral search with your city pair and dates filled in, in a new tab. No affiliate link, no commission.</p></header>
<form class="tr-form tr-card" method="get" action="/flights">
<label class="tr-field"><span>From</span><input name="from" value="${esc(v.from)}" maxlength="80" required placeholder="Lisbon"></label>
<label class="tr-field"><span>To</span><input name="to" value="${esc(v.to)}" maxlength="80" required placeholder="Tokyo"></label>
<label class="tr-field"><span>Depart</span><input type="date" name="depart" value="${esc(v.depart)}" required></label>
<label class="tr-field"><span>Return (optional)</span><input type="date" name="return" value="${esc(v.return)}"></label>
<button class="tr-btn" type="submit">Open the official search</button>
</form>
${error ? note(esc(error), 'error') : ''}
${result ? `<section class="tr-sec" id="tr-flight-result"><h2>Your search</h2><p><a class="tr-btn" href="${esc(result.url)}" rel="noopener" target="_blank">Flights ${esc(result.from)} → ${esc(result.to)}, ${esc(result.depart)}${result.return ? ` to ${esc(result.return)}` : ''}</a></p><p class="tr-fine">${esc(result.note)}</p></section>` : ''}
<section class="tr-sec"><div class="tr-sec-head"><h2>Providers</h2></div><ul class="tr-list"><li>Google Flights (official, airline-neutral): on, as a link only.</li><li>Duffel: ${providers.duffel ? 'a key is configured, but no adapter exists in v1, so it is off.' : 'off — no key.'}</li><li>Kiwi Tequila: ${providers.kiwi ? 'a key is configured, but no adapter exists in v1, so it is off.' : 'off — no key.'}</li></ul><p class="tr-fine">A later provider replaces the link behind the same form. Prices would then carry their source and fetch time.</p></section>
</div>`;
}

function signIn({ title = 'Sign in', text = 'This page is for a signed-in person.', next = '/' } = {}) {
    return `<div class="tr-wrap tr-narrow tr-page-pad" id="tr-sign-in"><header class="tr-page-h"><h1>${esc(title)}</h1><p class="tr-lede">${esc(text)}</p></header><p><a class="tr-btn" href="/auth/login?next=${encodeURIComponent(next)}">Sign in with OpenVibe</a></p></div>`;
}

function tripNew({ cities = [], values = {}, error = null } = {}) {
    const v = { title: '', city: '', starts_on: '', ends_on: '', notes: '', ...values };
    return `<div class="tr-wrap tr-narrow" id="tr-trip-new">
<header class="tr-page-h"><p class="tr-kicker">Trips</p><h1>Plan a trip</h1><p class="tr-lede">A city, dates and a name. After this you can save places, add a self-guided route and pick a stay; share it read-only when it is ready.</p></header>
${error ? note(esc(error), 'error') : ''}
<form class="tr-form tr-card" method="post" action="/trips">
<label class="tr-field"><span>Trip name</span><input name="title" value="${esc(v.title)}" maxlength="120" required placeholder="Lisbon in November"></label>
<label class="tr-field"><span>City</span><select name="city" required><option value="">Choose a city</option>${cities.map((c) => `<option value="${esc(c.slug)}"${c.slug === v.city ? ' selected' : ''}>${esc(c.name)}, ${esc(c.country)}</option>`).join('')}</select></label>
<label class="tr-field"><span>Starts</span><input type="date" name="starts_on" value="${esc(v.starts_on)}" required></label>
<label class="tr-field"><span>Ends</span><input type="date" name="ends_on" value="${esc(v.ends_on)}" required></label>
<label class="tr-field"><span>Notes (optional)</span><textarea name="notes" rows="4" maxlength="2000">${esc(v.notes)}</textarea></label>
<button class="tr-btn" type="submit">Create the trip</button>
</form></div>`;
}

function tripsPage({ trips = [] } = {}) {
    return `<div class="tr-wrap" id="tr-trips-page">
<header class="tr-page-h"><p class="tr-kicker">Trips</p><h1>Your trips</h1><p class="tr-lede">Private by default. A shared trip has a read-only link; only you can edit it. The API and forms never expose another person's trip.</p><p><a class="tr-btn" href="/trips/new">Plan a new trip</a></p></header>
${trips.length ? `<ol class="tr-trip-list">${trips.map((t) => `<li><a href="/trips/${esc(t.slug)}"><strong>${esc(t.title)}</strong><span class="tr-muted">${esc(t.city_name || t.city_slug || '')} · ${day(t.starts_on)} to ${day(t.ends_on)} · ${esc(t.visibility)}</span></a></li>`).join('')}</ol>` : empty('No trip yet. Start with a city and two dates.', '/trips/new', 'Plan a trip')}
</div>`;
}

function tripPage({ trip, mine = false, cities = [], places = [], route = null, stays = [] } = {}) {
    const shareUrl = `/trips/${trip.slug}`;
    return `<div class="tr-wrap" id="tr-trip-page">
<nav class="crumbs" aria-label="Breadcrumbs"><a href="/trips">Trips</a> / ${esc(trip.title)}</nav>
<header class="tr-page-h"><p class="tr-kicker">${esc(trip.city_name || '')} · ${day(trip.starts_on)} to ${day(trip.ends_on)}</p><h1>${esc(trip.title)}</h1>
${trip.notes ? `<p class="tr-lede">${esc(trip.notes)}</p>` : ''}
<p class="tr-fine">${esc(trip.visibility === 'shared' ? 'Shared read-only' : 'Private')}${mine ? '' : ' · you are reading a shared trip'} · last changed ${when(trip.updated_at)}</p></header>
${mine ? `<section class="tr-sec tr-card"><h2>Share and edit</h2><p class="tr-muted">${trip.visibility === 'shared' ? 'Anyone with this link can read it.' : 'Only you can read it.'}</p><p><code>${esc(shareUrl)}</code></p><form class="tr-form tr-form-inline" method="post" action="/trips/${esc(trip.slug)}/share"><input type="hidden" name="shared" value="${trip.visibility === 'shared' ? '0' : '1'}"><button class="tr-btn tr-btn-quiet" type="submit">${trip.visibility === 'shared' ? 'Make it private' : 'Share read-only'}</button></form>
<details class="tr-edit"><summary>Edit the name, city and dates</summary><form class="tr-form" method="post" action="/trips/${esc(trip.slug)}/edit">
<label class="tr-field"><span>Trip name</span><input name="title" value="${esc(trip.title)}" maxlength="120" required></label>
<label class="tr-field"><span>City</span><select name="city">${cities.map((c) => `<option value="${esc(c.slug)}"${c.id === trip.city_id ? ' selected' : ''}>${esc(c.name)}, ${esc(c.country)}</option>`).join('')}</select></label>
<label class="tr-field"><span>Starts</span><input type="date" name="starts_on" value="${esc(day(trip.starts_on))}" required></label>
<label class="tr-field"><span>Ends</span><input type="date" name="ends_on" value="${esc(day(trip.ends_on))}" required></label>
<label class="tr-field"><span>Notes</span><textarea name="notes" rows="3" maxlength="2000">${esc(trip.notes || '')}</textarea></label>
<button class="tr-btn" type="submit">Save the trip</button></form></details></section>` : ''}
<section class="tr-sec"><div class="tr-sec-head"><h2>Saved places</h2>${mine ? '' : `<span class="tr-muted">${places.length} places</span>`}</div>
${places.length ? `<ol class="tr-trip-places">${places.map((p) => `<li><span class="tr-stop-num" aria-hidden="true">${Number(p.position)}</span><div><a href="/place/${esc(p.id)}"><strong>${esc(p.name)}</strong></a><span class="tr-muted">${esc(p.city_name)}${p.trip_note ? ` · ${esc(p.trip_note)}` : ''}</span>${mine ? `<form class="tr-inline-form" method="post" action="/trips/${esc(trip.slug)}/places/${esc(p.id)}/remove"><button class="tr-link-btn" type="submit">Remove</button></form>` : ''}</div></li>`).join('')}</ol>` : empty('No place saved yet. Open a city and a place, then save it here.', trip.city_slug ? `/city/${trip.city_slug}` : '/cities', 'Find places')}
${mine ? `<form class="tr-form tr-form-inline" method="post" action="/trips/${esc(trip.slug)}/places"><label class="tr-field"><span>Place id</span><input name="place_id" required placeholder="plc_…" pattern="plc_[0-9A-HJKMNP-TV-Z]{26}"></label><label class="tr-field"><span>Note</span><input name="note" maxlength="500"></label><button class="tr-btn" type="submit">Save place</button></form><p class="tr-fine">The place id is on the place page. In the API: POST /api/v1/trips/${esc(trip.slug)}/places.</p>` : ''}
</section>
<section class="tr-sec"><div class="tr-sec-head"><h2>Route</h2>${mine ? `<a class="tr-more" href="${trip.city_slug ? `/city/${trip.city_slug}` : '/routes'}">Find a route</a>` : ''}</div>
${route ? `<p><a href="/routes/${esc(route.id)}"><strong>${esc(route.title)}</strong></a> <span class="tr-muted">${Number(route.stop_count)} stops · ${km(route.distance_m)}</span></p>${mine ? `<form method="post" action="/trips/${esc(trip.slug)}/route"><input type="hidden" name="route_id" value=""><button class="tr-btn tr-btn-quiet" type="submit">Remove route</button></form>` : ''}` : `<p class="tr-muted">No route added${mine ? '. Open a route and press “Add to trip”.' : '.'}</p>`}
</section>
<section class="tr-sec"><div class="tr-sec-head"><h2>Stays</h2>${mine ? `<a class="tr-more" href="/stays">Find a stay</a>` : ''}</div>
${stays.length ? `<ol class="tr-stay-list">${stays.map((s0) => `<li><a href="${esc(s0.url)}" rel="noopener"><strong>${esc(s0.title)}</strong><span class="tr-muted">${money(s0.price, s0.currency)} / ${esc(s0.period)}</span></a>${mine ? `<form class="tr-inline-form" method="post" action="/trips/${esc(trip.slug)}/stays/${esc(s0.id)}/remove"><button class="tr-link-btn" type="submit">Remove</button></form>` : ''}</li>`).join('')}</ol>` : `<p class="tr-muted">No stay added${mine ? '. Open a stay and add it here.' : '.'}</p>`}
${mine ? `<form class="tr-form tr-form-inline" method="post" action="/trips/${esc(trip.slug)}/stays"><label class="tr-field"><span>Stay id</span><input name="stay_id" required placeholder="sty_…" pattern="sty_[0-9A-HJKMNP-TV-Z]{26}"></label><button class="tr-btn" type="submit">Add stay</button></form>` : ''}
</section>
${mine ? `<section class="tr-sec tr-card"><h2>Delete this trip</h2><form method="post" action="/trips/${esc(trip.slug)}/delete"><button class="tr-btn tr-btn-quiet" type="submit">Delete the trip</button></form><p class="tr-fine">This erases the trip and its saved places, route and stays. Places and routes themselves are public data and stay.</p></section>` : ''}
</div>`;
}

function developersPage({ jobs = [] } = {}) {
    const routes = [
        ['GET /api/v1/cities', 'the catalogue, newest population first', '?limit=&offset=&q='],
        ['GET /api/v1/cities/:slug', 'one city, its places and routes', '?slug=lisbon'],
        ['GET /api/v1/places/:id', 'one OpenStreetMap place with source and fetch time', ''],
        ['GET /api/v1/routes/:id', 'one route with its ordered, cited stops', ''],
        ['GET /api/v1/live', 'IRL tours now and recent IRL VODs', ''],
        ['GET /api/v1/trips', 'the signed-in person\'s trips', ''],
        ['POST /api/v1/trips', 'create a trip { title, city_slug, starts_on, ends_on, notes? }', ''],
        ['GET /api/v1/trips/:slug', 'your trip, or a shared one read-only', ''],
        ['PATCH /api/v1/trips/:slug', 'edit title, city, dates, notes or visibility', ''],
        ['DELETE /api/v1/trips/:slug', 'delete your trip', ''],
        ['POST /api/v1/trips/:slug/places', 'save a place { place_id, note? }', ''],
        ['POST /api/v1/trips/:slug/route', 'set the trip\'s route { route_id }', ''],
        ['POST /api/v1/trips/:slug/stays', 'add a stay { stay_id }', ''],
        ['GET /api/v1/openapi.json', 'the OpenAPI 3.1 document', ''],
    ];
    return `<div class="tr-wrap tr-narrow" id="tr-developers-page">
<header class="tr-page-h"><p class="tr-kicker">For developers</p><h1>The OpenVibe.Tours API</h1>
<p class="tr-lede">Reads are public. A trip write is a signed-in Network person (the tours_at cookie or a Bearer user token); a session write must come from openvibe.tours itself. No route needs a service token. Errors are application/problem+json with a stable code.</p></header>
<div class="tr-table-wrap"><table class="tr-table"><thead><tr><th scope="col">Route</th><th scope="col">What it does</th><th scope="col">Query or body</th></tr></thead><tbody>${routes.map(([r, what, q]) => `<tr><td><code>${esc(r)}</code></td><td>${esc(what)}</td><td>${q ? `<code>${esc(q)}</code>` : '—'}</td></tr>`).join('')}</tbody></table></div>
<section class="tr-sec"><div class="tr-sec-head"><h2>OpenAPI</h2></div><p><a href="/api/v1/openapi.json">/api/v1/openapi.json</a> · <a href="/llms.txt">llms.txt</a> · <a href="/sitemap.xml">sitemap.xml</a></p></section>
<section class="tr-sec"><div class="tr-sec-head"><h2>Sources and licences</h2></div><ul class="tr-list"><li>OpenStreetMap via Overpass, ODbL 1.0; every place links its OSM object.</li><li>Wikivoyage, CC BY-SA 4.0; every route stop links the page it came from.</li><li>Wikidata, CC0; cities keep their Q id and every image keeps its Commons licence.</li><li>OpenVibe.Live and OpenVibe.Rent public APIs; read-only, never a token.</li></ul></section>
<section class="tr-sec"><div class="tr-sec-head"><h2>Source jobs</h2></div><p class="tr-muted">Each job records its run in tours_job_runs. Off under TOURS_DRILL; the intervals are env names in the README.</p><ul class="tr-jobs">${jobs.map((j) => `<li><b>${esc(j.job)}</b> ${esc(stateLabel(j.status))}${j.finished_at ? ` · ${when(j.finished_at)}` : ''}</li>`).join('') || '<li>No job has run yet.</li>'}</ul></section>
</div>`;
}

function notFound() {
    return `<div class="tr-wrap tr-narrow tr-page-pad" id="tr-not-found"><p class="tr-kicker">404</p><h1>Not here</h1><p class="tr-lede">That city, place, route or trip does not exist, or it is a private trip.</p><p><a class="tr-btn" href="/">Go home</a> <a class="tr-btn tr-btn-quiet" href="/cities">Browse cities</a></p></div>`;
}

module.exports = { safeImage, home, citiesPage, cityPage, placePage, routePage, livePage, staysPage, flightsPage, signIn, tripNew, tripsPage, tripPage, developersPage, notFound, placeOfDayCard, heroMotif, miniMap, SOURCE };
