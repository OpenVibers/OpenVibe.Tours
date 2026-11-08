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
const { placePath } = require('../store');

const SOURCE = {
    osm: '<a href="https://www.openstreetmap.org/copyright" rel="noopener">© OpenStreetMap contributors</a>, ODbL 1.0',
    wikivoyage: '<a href="https://en.wikivoyage.org" rel="noopener">Wikivoyage</a>, CC BY-SA 4.0',
    wikidata: '<a href="https://www.wikidata.org" rel="noopener">Wikidata</a>, CC0',
};

const day = (iso) => (iso ? esc(String(iso).slice(0, 10)) : '—');
const when = (iso) => (iso ? esc(String(iso).replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC')) : '—');
const km = (m) => (Number(m) >= 1000 ? `${(Number(m) / 1000).toFixed(1)} km` : `${Math.round(Number(m) || 0)} m`);
const safeHttp = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);
// A picture is drawn only from a URL that is one, on a host the page's img-src allows (server/app.js): Commons, or an
// OpenVibe site's image. A Wikivoyage listing's image field sometimes holds a share link (photos.app.goo.gl), which drew
// a broken image on the home (2026-11-01); an OSM image tag can name any host, and the place of the day asked for
// images.mapillary.com, which the policy refuses and which no longer answers (2026-11-02).
const IMAGE_HOSTS = /^(upload|commons|thumb)\.wikimedia\.org$|^openvibe\.(media|rent|live|network)$/i;
const safeImage = (v) => {
    const u = safeHttp(v);
    if (!u) return null;
    try {
        const { protocol, hostname, pathname } = new URL(u);
        if (protocol !== 'https:' || !IMAGE_HOSTS.test(hostname)) return null;
        return /wikimedia\.org$/i.test(hostname) || (hostname === 'openvibe.media' && (/^\/api\/v2\/tours\/objects\//.test(pathname) || /^\/o\/[A-Za-z0-9_-]{6,64}$/.test(pathname)))
            || /\.(jpe?g|png|webp|gif|avif|svg)$/i.test(pathname) ? u : null;
    } catch { return null; }
};
const licensedPhoto = (p) => p && p.image_credit && p.image_license && p.image_source_url && safeImage(p.image_url);
const credit = (p) => `<figcaption>Photo: ${esc(p.image_credit)} · ${esc(p.image_license)} · <a href="${esc(p.image_source_url)}" rel="noopener">source</a>${p.image_license_url ? ` · <a href="${esc(p.image_license_url)}" rel="noopener">licence</a>` : ''}</figcaption>`;
// Wikimedia's imageinfo thumbnail URL is already a verified derivative. Only Special:FilePath
// supports a requested width reliably; Media serves the cached production thumbnail directly.
function imageWidth(u, w) {
    if (!u) return null;
    try {
        const url = new URL(u);
        if (/(^|\.)commons\.wikimedia\.org$/i.test(url.hostname) && /^\/wiki\/Special:FilePath\//.test(url.pathname)) {
            url.searchParams.set('width', String(w));
            return url.toString();
        }
        if (/(^|\.)wikimedia\.org$/i.test(url.hostname)) {
            // Commons only guarantees the exact thumbnail URL returned by imageinfo. Asking for a new width
            // can answer 400 for a file whose derivatives have not been rendered yet.
            // Commons returns an original URL when the requested thumbnail would enlarge a small image.
            // Turning that original back into a 640px thumbnail makes Wikimedia answer 400.
        }
    } catch { /* not a URL: use it unchanged */ }
    return null;
}
const IMAGE_WIDTHS = [330, 640];
/** A picture at the widths a card draws (330 for a phone, 640 for a 2x screen), never the 1200 stored. */
function pictureImg(u, { alt = '', sizes = '(max-width: 720px) 80vw, 330px', width = 640, height = 360, eager = false, widths = IMAGE_WIDTHS } = {}) {
    const src = imageWidth(u, widths[widths.length - 1]) || u;
    const pairs = widths.map((w) => [w, imageWidth(u, w)]).filter(([, v]) => v);
    const srcset = pairs.length ? ` srcset="${esc(pairs.map(([w, v]) => `${v} ${w}w`).join(', '))}" sizes="${esc(sizes)}"` : '';
    return `<img src="${esc(src)}"${srcset} width="${width}" height="${height}" alt="${esc(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`;
}
/** Give safe card pictures a stable 16:9 box, using the verified Commons or Media URL. */
function card(opts) {
    const html = kit.card(opts);
    if (!safeImage(opts.image)) return html;
    return html.replace(/<img\b[^>]*>/, pictureImg(opts.image, { alt: opts.alt || '', sizes: '(max-width: 720px) 80vw, 330px' }));
}
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

const cityCard = (c) => card({
    href: `/city/${c.slug}`,
    title: c.name,
    type: 'map',
    image: licensedPhoto(c) || '',
    alt: c.image_credit ? `${c.name} (${c.image_credit})` : c.name,
    badge: c.country || '',
    who: c.country || '',
    count: [Number(c.place_count) || 0, Number(c.place_count) === 1 ? 'place' : 'places'],
    peek: c.summary ? String(c.summary).slice(0, 120) : '',
    level: 3,
});

/** A place's name as a reader of English finds it: OpenStreetMap's English name when there is one, else its own. */
const placeName = (p) => (p && p.name_en) || (p && p.name) || '';
/** The place's own name when the English one is shown instead (洪崖洞 beside Hongya Cave), else ''. */
const localName = (p) => (p && p.name_en && p.name && p.name !== p.name_en ? p.name : '');
/** A place's kind for its row, unless its name already ends with it ("Bose museum" was followed by "museum"). */
const kindUnlessNamed = (p) => { const k = String(p.kind || '').replace(/_/g, ' '); return k && !placeName(p).toLowerCase().endsWith(k.toLowerCase()) ? k : ''; };

const placeCard = (p) => card({
    href: placePath(p),
    title: placeName(p),
    type: 'map',
    image: licensedPhoto(p) || '',
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
<a class="tr-pod-link" href="${esc(placePath(p))}">
${licensedPhoto(p) ? pictureImg(p.image_url, { alt: placeName(p) }) : '<span class="tr-pod-noimg" aria-hidden="true">◆</span>'}
<span class="tr-pod-body"><span class="tr-kicker">Place of the day · ${esc(p.city_name || '')}</span><strong>${esc(placeName(p))}</strong>
<span class="tr-muted">${esc(p.kind ? p.kind.replace(/_/g, ' ') : 'place')}${p.description ? ` · ${esc(clip(p.description, 150))}` : ''}</span></span>
</a></article>`;
}

/** The home's questions: the accordion on the page and the FAQPage data (server/http/discovery.js) are this one list. */
const HOME_FAQ = [
    ['Where does the data come from?', 'Wikivoyage (CC BY-SA), Wikidata (CC0), Wikipedia (CC BY-SA) and OpenStreetMap (ODbL) for cities and places; photos from Wikimedia Commons and Openverse under CC BY, CC BY-SA, CC0 or public domain, each with its author and licence; OpenVibe.Live\'s public streams and OpenVibe.Rent\'s public listings. Every city, place, route and source row shows its source and fetch time.'],
    ['Are the routes real guided tours?', 'No. They are self-guided walks generated from Wikivoyage\'s See lists and marked as generated. Check opening hours and access before you go; the note at each stop is the Wikivoyage text, cited.'],
    ['Do you sell flights or stays?', 'No. There is no flight API key in v1: the flight form opens the official airline-neutral search with the city pair filled in, with no affiliate parameter. Stays link to the listing on OpenVibe.Rent; Tours never takes a payment.'],
    ['Is there audio on the stops?', 'Not yet. OpenVibe.AI has no speech-synthesis route today, so every stop says audio is off instead of shipping a broken player. The audio fields are in the schema for when an API exists.'],
    ['Who can see my trip?', 'Only you, until you share it. Everyone and Anyone with the link are readable by whoever has the address; Specific people is only the accounts you add, each Can view or Can edit; Only me is you. Your Share button changes one trip, and /trips sets what a new trip starts as. Delete it at any time; account deletion erases your trips.'],
    ['Why is a city missing?', 'It is not missing: search it. Any city or town opens on demand from OpenStreetMap, Wikidata and Wikivoyage (the first visit takes a moment while its places are gathered). A failed source run leaves the previous data and says so in the job receipt rather than inventing a place.'],
];

/** The walk scene: the first real route's own first stops, each linked from the route page. */
function homeWalk(route) {
    const stops = route && Array.isArray(route.stops) ? route.stops.slice(0, 3) : [];
    if (!stops.length) {
        return `<div class="tr-demo-walk"><span class="tr-demo-stop">No route built yet</span><small>Routes are generated from a city's Wikivoyage See list; the first one shows here.</small><a href="/routes">Find a walk</a></div>`;
    }
    const named = stops.map((s, i) => `<span class="tr-demo-stop">${i + 1} · ${esc(s.title)}</span>`).join('<span class="tr-demo-line"></span>');
    return `<div class="tr-demo-walk">${named}<small>${esc(route.title || 'A walk')}${route.city_name ? ` · ${esc(route.city_name)}` : ''} · <a href="/routes/${esc(route.slug)}">the route</a> · Wikivoyage CC BY-SA · OpenStreetMap ODbL</small></div>`;
}

/** The live scene: the first real IRL stream, else the first real recording, else an honest "nobody is live". */
function homeLive(live, recent) {
    const l = (live && live[0]) || (recent && recent[0]) || null;
    if (!l) {
        return `<div class="tr-demo-live"><span class="tr-live-dot" aria-hidden="true"></span><b>Nobody is live right now</b><span>IRL streams from OpenVibe.Live show here when they start.</span><small>No follow, no write, no token.</small></div>`;
    }
    const isLive = l.kind === 'stream';
    const meta = [l.category, isLive && Number(l.viewer_count) ? `${Number(l.viewer_count)} watching` : '', 'OpenVibe.Live'].filter(Boolean).join(' · ');
    return `<div class="tr-demo-live"><span class="tr-live-dot" aria-hidden="true"></span><b>${isLive ? 'Live now' : 'Recent recording'}</b><span>${esc(l.title)}${l.display_name || l.username ? ` · ${esc(l.display_name || l.username)}` : ''}</span><small>${esc(meta)} · <a href="${esc(l.url)}" rel="noopener">watch</a></small></div>`;
}

function home({ counts = {}, live = [], recent = [], placeOfDay = null, cities = [], routes = [], stays = [], jobs = [], route = null } = {}) {
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
            lede: 'Places worth going in any city, with real photos and what to look for; plans and lists to go together; streams from the places themselves. Every fact names its source.',
            search: { action: '/cities', name: 'q', placeholder: 'Any city: Seattle, Lisbon, Tokyo…', hints: ['Seattle', 'Lisbon', 'Tokyo', 'Mexico City'], label: 'Find a city' },
            chips: [{ label: 'Live tours', href: '/live' }, { label: 'Routes', href: '/routes' }, { label: 'Stays', href: '/stays' }, { label: 'Flights', href: '/flights' }],
            proof,
            motif: heroMotif(),
        },
        rails,
        scenes: [
            {
                title: 'Walk a city with a cited note at every stop',
                text: 'A route is ordered stops on a map, generated from Wikivoyage\'s See lists and marked as generated. Every stop links the Wikivoyage page it came from, the OpenStreetMap place it matches, and its coordinates.',
                html: homeWalk(route),
                action: { href: '/routes', label: 'Find a walk' },
            },
            {
                title: 'Watch a real place, now',
                text: 'Live tours are IRL streams from OpenVibe.Live\'s public stream list, with the viewer count and the city when the title or tags name one. Recorded IRL tours link to their VOD and clips to openvibe.video. Tours never posts to Live or chat.',
                html: homeLive(live, recent),
                action: { href: '/live', label: 'Watch live tours' },
            },
            {
                title: 'Build a trip and share it read-only',
                text: 'Sign in with OpenVibe, pick a city and dates, save places, add a route and a stay, then share it with the people going with you. Can edit means they plan it with you; Group voting is not in v1.',
                html: `<div class="tr-demo-trip"><span class="tr-trip-day">Fri</span><b>Land · check in</b><span class="tr-trip-day">Sat</span><b>Walk the See list</b><span class="tr-trip-day">Sun</span><b>Market, then home</b><small>Example itinerary · private by default · shared on purpose</small></div>`,
                action: { href: '/trips/new', label: 'Plan a trip' },
            },
        ],
        explore: {
            title: 'What a trip is made of',
            items: [
                { title: 'Cities', text: 'Any city, on demand: things to do and free things to do, from Wikivoyage, Wikidata and OpenStreetMap.', href: '/cities', icon: 'map' },
                { title: 'Places', text: 'Sights, parks, museums and viewpoints, each with a credited photo, why go, what to look for and how to visit.', href: '/cities', icon: 'pin' },
                { title: 'Live tours', text: 'IRL streams now and recent VODs from OpenVibe.Live.', href: '/live', icon: 'live' },
                { title: 'Stays', text: 'Rentals from OpenVibe.Rent; no payment is handled here.', href: '/stays', icon: 'home' },
                { title: 'Flights', text: 'No key yet: a form opens the official airline-neutral search.', href: '/flights', icon: 'plane' },
                { title: 'Trips', text: 'A city, dates, saved places, a route and stays — shared with the people going with you.', href: '/trips', icon: 'calendar' },
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
        faq: { items: HOME_FAQ },
    });
    const jobsLine = jobs.length
        ? `<section class="tr-sec tr-sources" aria-labelledby="tr-sources-h"><h2 id="tr-sources-h">Sources and fetch times</h2><p class="tr-muted">${esc(SOURCE.osm.replace(/<[^>]+>/g, ''))} · Wikivoyage CC BY-SA 4.0 · Wikidata CC0 · OpenVibe.Live · OpenVibe.Rent. Last source run ${lastFetch ? when(lastFetch) : 'not yet'}.</p><ul class="tr-jobs">${jobs.map((j) => `<li><b>${esc(j.job)}</b> ${esc(stateLabel(j.status))}${j.finished_at ? ` · ${when(j.finished_at)}` : ''}${j.error ? ` · ${esc(String(j.error).slice(0, 200))}` : ''}</li>`).join('')}</ul></section>`
        : '';
    return `<div class="tr-wrap tr-home" id="tr-home">${room}${jobsLine}</div>`;
}

function citiesPage({ cities = [], q = '' } = {}) {
    return `<div class="tr-wrap" id="tr-cities-page">
<header class="tr-page-h"><p class="tr-kicker">Explore</p><h1>Things to do anywhere</h1>
<p class="tr-lede">Search for any city or place. Pages are built from OpenStreetMap, Wikivoyage and Wikidata when you need them.</p>
<form class="tr-form tr-form-inline" method="get" action="/cities" role="search"><label class="tr-field"><span>Find a city</span><input type="search" name="q" value="${esc(q)}" maxlength="80" placeholder="Lisbon"></label><button class="tr-btn" type="submit">Search</button></form></header>
<form class="tr-form tr-form-inline" method="get" action="/places" role="search"><label class="tr-field"><span>Find a place</span><input type="search" name="q" maxlength="120" placeholder="Kubota Garden"></label><button class="tr-btn" type="submit">Find place</button></form>
${cities.length ? `<ol class="tr-city-list">${cities.map((c) => `<li class="tr-city-row"><a href="/city/${esc(c.slug)}">
<span class="tr-city-photo">${licensedPhoto(c) ? pictureImg(c.image_url, { alt: '', sizes: '58px', width: 58, height: 44, widths: [160, 330] }) : '<span aria-hidden="true">◆</span>'}</span>
<span class="tr-city-text"><strong>${esc(c.name)}</strong><span class="tr-muted">${esc(c.country)}${c.population ? ` · ${Number(c.population).toLocaleString('en-US')} people` : ''}</span>
<span class="tr-muted">${Number(c.place_count) || 0} places · ${Number(c.route_count) || 0} routes</span></span></a></li>`).join('')}</ol>` : empty('No city matched that search.', '/cities', 'See all cities')}
<p class="tr-fine">${SOURCE.wikidata} · ${SOURCE.wikivoyage} · ${SOURCE.osm}</p>
</div>`;
}

const OSM_DAY = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun', PH: 'holidays' };
/** OpenStreetMap opening_hours in words for the common shapes ("Mo-Su 06:00-22:00" → "Every day 6:00–22:00"); any
 *  other syntax is shown exactly as written, never guessed. */
function hoursInWords(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw === '24/7') return 'Open 24 hours';
    const day = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)';
    const span = `${day}(?:-${day})?`;
    const re = new RegExp(`^(${span}(?:,${span})*)\\s+(off|closed|\\d{1,2}:\\d{2}-\\d{1,2}:\\d{2}(?:,\\d{1,2}:\\d{2}-\\d{1,2}:\\d{2})*)$`);
    const parts = raw.split(/\s*;\s*/).filter(Boolean).map((part) => {
        const m = part.match(re);
        if (!m) return null;
        const days = m[1] === 'Mo-Su' ? 'Every day' : m[1].replace(/Mo|Tu|We|Th|Fr|Sa|Su|PH/g, (d) => OSM_DAY[d]).replace(/-/g, '–').replace(/,/g, ', ');
        const times = /^(off|closed)$/.test(m[2]) ? 'closed' : m[2].replace(/\b0(\d):/g, '$1:').replace(/-/g, '–').replace(/,/g, ', ');
        return `${days} ${times}`;
    });
    return parts.length && parts.every(Boolean) ? parts.join(' · ') : raw;
}
/** "Nov 8, 2026" from a stored ISO time. */
const updatedOn = (iso) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'website'; } };
const sourceName = (p) => (p.source === 'wikivoyage' ? 'Wikivoyage' : p.source === 'wikipedia' ? 'Wikipedia' : 'OpenStreetMap');
/** A short credit for a photo inside a card: author, licence, source link (every image keeps all three). */
const shortCredit = (p) => `<p class="tr-pcard-credit">Photo: ${esc(p.image_credit)} · ${esc(p.image_license)} · <a href="${esc(p.image_source_url)}" rel="noopener">source</a></p>`;

/** One place in a city's grid: the photo (or its map pin when no licensed photo exists), name, kind and facts. */
function placeTile(p) {
    const photo = licensedPhoto(p);
    const facts = [localName(p), kindUnlessNamed(p), p.address, p.wheelchair === 'yes' ? 'step-free' : '', p.fee === 'no' ? 'free to visit' : ''].filter(Boolean).join(' · ');
    return `<li class="tr-pcard${photo ? '' : ' tr-pcard-text'}">
${photo ? `<div class="tr-pcard-media">${pictureImg(p.image_url, { alt: placeName(p), width: 640, height: 480, sizes: '(max-width: 560px) 46vw, (max-width: 900px) 30vw, 280px' })}</div>` : ''}
<div class="tr-pcard-body">${photo ? '' : '<svg class="tr-pcard-pin" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/></svg>'}<h3><a href="${esc(placePath(p))}">${esc(placeName(p))}</a></h3>${facts ? `<p class="tr-pcard-meta">${esc(facts)}</p>` : ''}${p.fee === 'no' ? '<span class="tr-pill">Free</span>' : ''}</div>
${photo ? shortCredit(p) : ''}
</li>`;
}

function cityPage({ city, places = [], routes = [], live = [], stays = [], free = false } = {}) {
    const img = licensedPhoto(city);
    // Photographed places first (rank order kept within each group): rows of the grid stay even.
    places = [...places.filter((p) => licensedPhoto(p)), ...places.filter((p) => !licensedPhoto(p))];
    const mapHref = `https://www.openstreetmap.org/?mlat=${city.lat}&mlon=${city.lon}#map=12/${city.lat}/${city.lon}`;
    return `<div class="tr-wrap" id="tr-city-page">
<nav class="crumbs" aria-label="Breadcrumbs"><a href="/cities">Cities</a> / ${esc(city.name)}</nav>
<header class="tr-city-hero${img ? '' : ' tr-city-hero-plain'}">
${img ? `<figure class="tr-city-cover">${pictureImg(img, { alt: city.name, sizes: '(max-width: 720px) 100vw, 1180px', width: 1200, height: 560, widths: [640, 1200], eager: true })}<figcaption>Photo: ${esc(city.image_credit)} · ${esc(city.image_license)} · <a href="${esc(city.image_source_url)}" rel="noopener">source</a>${city.image_license_url ? ` · <a href="${esc(city.image_license_url)}" rel="noopener">licence</a>` : ''}</figcaption></figure>` : ''}
<div class="tr-city-intro">
<p class="tr-kicker">${esc(city.country)}${city.region ? ` · ${esc(city.region)}` : ''}</p>
<h1>${free ? 'Free things to do' : 'Things to do'} in ${esc(city.name)}</h1>
${city.summary ? `<p class="tr-lede">${esc(city.summary)}</p>` : note('No Wikivoyage summary was fetched for this city yet.', 'warn')}
<p class="tr-fine">${city.population ? `${Number(city.population).toLocaleString('en-US')} people · ` : ''}<a href="${esc(mapHref)}" rel="noopener">Map</a> · <a href="${esc(city.source_url)}" rel="noopener">${esc(city.source === 'wikivoyage' ? 'Wikivoyage' : 'Wikidata')}</a> · fetched ${esc(updatedOn(city.fetched_at))}</p>
</div>
</header>
<nav class="tr-seg" aria-label="Which places">
<a href="/city/${esc(city.slug)}"${free ? '' : ' aria-current="page"'}>All places</a>
<a href="/city/${esc(city.slug)}/free"${free ? ' aria-current="page"' : ''}>Free things to do</a>
</nav>
<section class="tr-sec" id="tr-city-places"><div class="tr-sec-head"><h2>${free ? 'Verified free places' : 'Places worth going'}${places.length ? ` <span class="tr-count">${places.length}</span>` : ''}</h2><a class="tr-more" href="${esc(mapHref)}" rel="noopener">Open the map</a></div>
${free ? '<p class="tr-muted">Free means OpenStreetMap currently marks the place fee=no. Check the place’s own site before you go.</p>' : ''}
${places.length ? `<ol class="tr-pgrid">${places.slice(0, 24).map(placeTile).join('')}</ol>${places.length > 24 ? `<details class="tr-fold"><summary>More places (${places.length - 24})</summary><ol class="tr-pgrid">${places.slice(24).map(placeTile).join('')}</ol></details>` : ''}` : empty(free ? 'No place has a confirmed free admission tag yet.' : 'No sourced place was stored for this city yet.', '/cities', 'Another city')}
<p class="tr-fine">${SOURCE.osm}</p></section>
${routes.length ? `<section class="tr-sec"><div class="tr-sec-head"><h2>Self-guided routes</h2><span class="tr-muted">from Wikivoyage's See list</span></div><ol class="tr-route-list">${routes.map((r) => `<li><a href="/routes/${esc(r.id)}"><strong>${esc(r.title)}</strong><span class="tr-muted">${Number(r.stop_count)} stops · ${km(r.distance_m)} · ${Number(r.duration_min)} min</span></a></li>`).join('')}</ol></section>` : ''}
${live.length ? `<section class="tr-sec"><div class="tr-sec-head"><h2>Live tours and recordings</h2><a class="tr-more" href="/live">All live</a></div><ol class="tr-live-list">${live.map((l) => `<li><a href="${esc(l.url)}" rel="noopener"><strong>${esc(l.title)}</strong><span class="tr-muted">${esc(l.kind === 'stream' ? 'Live now' : l.kind === 'clip' ? 'Clip' : 'Recording')} · ${esc(l.display_name || l.username)}${l.city_name ? ` · ${esc(l.city_name)}` : ''}${l.kind === 'stream' ? ` · ${Number(l.viewer_count)} watching` : ''}</span></a></li>`).join('')}</ol><p class="tr-fine">OpenVibe.Live's public stream list · fetched ${esc(updatedOn(live[0].fetched_at))}</p></section>` : ''}
${stays.length ? `<section class="tr-sec"><div class="tr-sec-head"><h2>Stays</h2><a class="tr-more" href="/stays">All stays</a></div><ol class="tr-stay-list">${stays.map((s0) => `<li><a href="${esc(s0.url)}" rel="noopener"><strong>${esc(s0.title)}</strong><span class="tr-muted">${esc(s0.kind)} · ${money(s0.price, s0.currency)} / ${esc(s0.period)}${s0.neighbourhood ? ` · ${esc(s0.neighbourhood)}` : ''}</span></a></li>`).join('')}</ol><p class="tr-fine">OpenVibe.Rent's public listings · never a payment on Tours.</p></section>` : ''}
<section class="tr-sec tr-band"><h2>Plan a trip here</h2><p class="tr-muted">Pick dates, save places from ${esc(city.name)} and add a route and a stay.</p><p class="tr-actions"><a class="tr-btn" href="/trips/new?city=${encodeURIComponent(city.slug)}">Start a trip in ${esc(city.name)}</a> <a class="tr-btn tr-btn-quiet" href="/flights?to=${encodeURIComponent(city.name)}">Find a flight</a></p></section>
</div>`;
}

function placePage({ place, routeList = [], trips = [], nearby = [], live = [], summary = null } = {}) {
    const sentences = (place.description || '').split(/(?<=[.!?])\s+/).filter(Boolean);
    const seasonal = sentences.find((s) => /\b(spring|summer|autumn|fall|winter|bloom|blossom|season)\b/i.test(s));
    const guided = sentences.find((s) => /\b(guided tour|free tour)\b/i.test(s));
    const now = new Date();
    const springYear = now.getUTCMonth() < 2 || (now.getUTCMonth() === 2 && now.getUTCDate() < 21) ? now.getUTCFullYear() : now.getUTCFullYear() + 1;
    const springDate = `${springYear}-03-21`;
    const name = placeName(place);
    const lede = sentences[0] || `${name} in ${place.city_name}.`;
    // Why go never repeats the lede: the AI summary when there is one, else the description after its first sentence.
    const why = summary?.text || sentences.slice(1).join(' ');
    const lookFor = place.guide_features && place.guide_features !== place.description ? place.guide_features : '';
    const season = place.guide_season || seasonal || '';
    const visit = place.guide_visit || guided || '';
    const planHref = `https://openvibe.fun/plans/new?${new URLSearchParams({ place: name, city: place.city_name, url: `https://openvibe.tours${placePath(place)}`, lat: String(place.lat), lon: String(place.lon) })}`;
    const listHref = `https://openvibe.fun/places/new?${new URLSearchParams({ place: name, url: `https://openvibe.tours${placePath(place)}` })}`;
    const liveHref = `https://openvibe.live/broadcast?${new URLSearchParams({ place: name, place_url: `https://openvibe.tours${placePath(place)}`, title: `At ${name}` })}`;
    const photos = [];
    if (licensedPhoto(place)) photos.push({ url: place.image_url, credit: place.image_credit, license: place.image_license, sourceUrl: place.image_source_url, licenseUrl: place.image_license_url });
    for (const photo of place.gallery || []) {
        if (photos.length >= 6) break;
        if (photos.some((x) => x.url === photo.url)) continue;
        if (licensedPhoto({ image_url: photo.url, image_credit: photo.credit, image_license: photo.license, image_source_url: photo.sourceUrl })) photos.push(photo);
    }
    const figure = (photo, i) => `<figure class="${i ? 'tr-shot' : 'tr-hero-shot'}">${pictureImg(photo.url, i
        ? { alt: `${name}, photo ${i + 1} of ${photos.length}`, sizes: '(max-width: 720px) 70vw, 280px', width: 440, height: 300 }
        : { alt: name, sizes: '(max-width: 720px) 100vw, 760px', width: 1000, height: 620, widths: [640, 1000], eager: true })}<figcaption>Photo: ${esc(photo.credit)} · ${esc(photo.license)} · <a href="${esc(photo.sourceUrl)}" rel="noopener">source</a>${photo.licenseUrl ? ` · <a href="${esc(photo.licenseUrl)}" rel="noopener">licence</a>` : ''}</figcaption></figure>`;
    const hours = hoursInWords(place.opening_hours);
    const admission = place.fee === 'no' ? 'Free to visit' : place.fee === 'yes' ? 'Paid admission' : 'Admission not confirmed';
    const reminder = `<form method="get" action="/remind-place/${esc(place.id)}" class="tr-form tr-form-inline tr-remind"><label class="tr-field"><span>Remind us on a date</span><input type="date" name="date" required></label><button class="tr-btn tr-btn-quiet" type="submit">Set reminder</button></form>`;
    return `<div class="tr-wrap" id="tr-place-page">
<nav class="crumbs" aria-label="Breadcrumbs"><a href="/cities">Cities</a> / <a href="/city/${esc(place.city_slug)}">${esc(place.city_name)}</a></nav>
<div class="tr-place-top${photos.length ? '' : ' tr-place-top-solo'}">
<header class="tr-place-head">
<p class="tr-kicker">${esc(String(place.kind || 'place').replace(/_/g, ' '))}${place.fee === 'no' ? ' <span class="tr-pill">Free</span>' : ''}</p>
<h1>${esc(name)}</h1>${localName(place) ? `\n<p class="tr-local-name">${esc(localName(place))}</p>` : ''}
<p class="tr-lede">${esc(lede)}</p>
<div class="tr-together"><p class="tr-together-h">Go here together</p><p class="tr-actions"><a class="tr-btn" href="${esc(planHref)}">Make a plan together</a> <a class="tr-btn tr-btn-quiet" href="${esc(listHref)}">Add to Our places</a></p><p class="tr-fine">A date poll for your people, or a shared list of places you want to see.</p></div>
</header>
${photos.length ? `<div class="tr-place-media">${figure(photos[0], 0)}${photos.length > 1 ? `<div class="tr-rail-wrap"><p class="tr-rail-count">${photos.length - 1} more ${photos.length - 1 === 1 ? 'photo' : 'photos'}</p><ul class="tr-rail" aria-label="More photos of ${esc(name)}">${photos.slice(1).map((p, i) => `<li>${figure(p, i + 1)}</li>`).join('')}</ul></div>` : ''}</div>` : ''}
<ul class="tr-quick" aria-label="At a glance">
${place.fee === 'no' ? '<li><strong>Free to visit</strong><span>OpenStreetMap</span></li>' : ''}
${hours ? `<li><strong>${esc(hours)}</strong><span>opening hours</span></li>` : ''}
${place.wheelchair ? `<li><strong>${place.wheelchair === 'yes' ? 'Step-free' : place.wheelchair === 'limited' ? 'Partly step-free' : 'Not step-free'}</strong><span>access</span></li>` : ''}
<li><a href="${esc(place.map_url)}" rel="noopener"><strong>Directions</strong><span>${place.address ? esc(place.address) : 'open the map'}</span></a></li>
${safeHttp(place.website) ? `<li><a href="${esc(place.website)}" rel="nofollow noopener"><strong>Official site</strong><span>${esc(hostOf(place.website))}</span></a></li>` : ''}
${place.fee === 'no' ? '' : `<li><strong>${esc(admission)}</strong><span>${place.fee ? 'OpenStreetMap' : 'check before you go'}</span></li>`}
</ul>
</div>
<div class="tr-guide">
${why ? `<section class="tr-sec"><h2>Why go</h2><p>${esc(why)}</p><p class="tr-fine">${summary ? 'A summary by OpenVibe.AI of the cited sources · ' : ''}Source: <a href="${esc(place.source_url)}" rel="noopener">${esc(sourceName(place))}</a></p></section>` : ''}
${lookFor ? `<section class="tr-sec"><h2>Look for</h2><p>${esc(lookFor)}</p><p class="tr-fine">Source: <a href="${esc(place.source_url)}" rel="noopener">${esc(sourceName(place))}</a></p></section>` : ''}
<section class="tr-sec"><h2>How to visit</h2><p>${esc(admission)}${place.fee ? ' (OpenStreetMap)' : ''}. Check the hours and access before you travel.</p>${visit ? `<p>${esc(visit)} <a href="${esc(place.source_url)}" rel="noopener">Source</a></p>` : ''}${place.address ? `<p class="tr-muted">${esc(place.address)}</p>` : ''}</section>
${season ? `<section class="tr-sec tr-season"><h2>Best time</h2><p>${esc(season)}</p><p class="tr-fine"><a href="${esc(place.source_url)}" rel="noopener">Source</a></p><p class="tr-actions"><a class="tr-btn tr-btn-quiet" href="/remind-place/${esc(place.id)}?date=${springDate}">Remind us in spring</a></p>${reminder}</section>` : ''}
</div>
${season ? '' : `<section class="tr-sec"><h2>Come back later</h2><p class="tr-muted">Ask for a reminder on the day you want to go.</p>${reminder}</section>`}
<section class="tr-sec"><div class="tr-sec-head"><h2>See it live</h2><a class="tr-btn tr-btn-quiet" href="${esc(liveHref)}">Stream it from here</a></div>${live.length ? `<ol class="tr-live-list">${live.map((l) => `<li><a href="${esc(l.url)}" rel="noopener"><strong>${esc(l.title)}</strong><span class="tr-muted">${esc(l.kind === 'stream' ? 'Live now' : l.kind === 'clip' ? 'Clip' : 'Recording')} · ${esc(l.display_name || l.username)}</span></a></li>`).join('')}</ol>` : '<p class="tr-muted">No public streams or clips from here yet. Stream it and you are the first: OpenVibe.Live opens its go-live setup, and you choose when to start.</p>'}</section>
${nearby.length ? `<section class="tr-sec"><div class="tr-sec-head"><h2>Nearby</h2></div><ol class="tr-pgrid tr-pgrid-small">${nearby.map(placeTile).join('')}</ol></section>` : ''}
${routeList.length ? `<section class="tr-sec"><div class="tr-sec-head"><h2>On these routes</h2></div><ol class="tr-route-list">${routeList.map((r) => `<li><a href="/routes/${esc(r.id)}"><strong>${esc(r.title)}</strong><span class="tr-muted">${esc(r.city_name)} · ${Number(r.stop_count)} stops</span></a></li>`).join('')}</ol></section>` : ''}
${trips.length ? `<section class="tr-sec"><div class="tr-sec-head"><h2>Save it to a trip</h2></div><form class="tr-form tr-form-inline" method="post" action="/trips/${esc(trips[0].slug)}/places"><input type="hidden" name="place_id" value="${esc(place.id)}"><label class="tr-field"><span>Trip</span><select name="trip">${trips.map((t) => `<option value="${esc(t.slug)}">${esc(t.title)}</option>`).join('')}</select></label><label class="tr-field"><span>Note (optional)</span><input name="note" maxlength="500"></label><button class="tr-btn" type="submit">Save place</button></form></section>` : `<section class="tr-sec"><p class="tr-muted"><a href="/auth/login?next=${encodeURIComponent(placePath(place))}">Sign in</a> to save this place to a trip.</p></section>`}
<footer class="tr-sources"><h2>Sources</h2><p>${place.osm_url ? `<a href="${esc(place.osm_url)}" rel="noopener">OpenStreetMap</a> · ` : ''}<a href="${esc(place.source_url)}" rel="noopener">${esc(sourceName(place))}</a>${place.wikidata_id ? ` · <a href="https://www.wikidata.org/wiki/${esc(place.wikidata_id)}" rel="noopener">Wikidata</a>` : ''} · fetched ${esc(updatedOn(place.fetched_at))}</p><p>${SOURCE.osm}</p></footer>
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
<header class="tr-page-h"><p class="tr-kicker">Trips</p><h1>Plan a trip</h1><p class="tr-lede">A city, dates and a name. After this you can save places, add a self-guided route and pick a stay; share it with the people going with you when it is ready.</p></header>
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

function tripsPage({ trips = [], defaultAudience = 'private' } = {}) {
    const audienceText = { private: 'Only me', people: 'Specific people', link: 'Anyone with the link', public: 'Everyone' };
    const audienceWord = (v) => (v === 'shared' ? 'Anyone with the link' : 'Only me');
    const options = ['private', 'people', 'link', 'public']
        .map((a) => `<option value="${a}"${a === defaultAudience ? ' selected' : ''}>${audienceText[a]}</option>`).join('');
    return `<div class="tr-wrap" id="tr-trips-page">
<header class="tr-page-h"><p class="tr-kicker">Trips</p><h1>Your trips</h1><p class="tr-lede">Only me by default. Share a trip with the people going with you, with Can edit, and you plan it together. The API and forms never expose another person's trip.</p><p><a class="tr-btn" href="/trips/new">Plan a new trip</a></p></header>
<section class="tr-sec tr-card"><h2>New trips</h2>
<form class="tr-form tr-form-inline" method="post" action="/trips/defaults">
<label class="tr-field"><span>Who can open a new trip</span><select name="audience">${options}</select></label>
<label class="tr-check"><input type="checkbox" name="apply_all" value="1"> Apply to all my existing trips</label>
<button class="tr-btn" type="submit">Save</button>
</form><p class="tr-fine">A trip's Share button changes just that trip.</p></section>
${trips.length ? `<ol class="tr-trip-list">${trips.map((t) => `<li><a href="/trips/${esc(t.slug)}"><strong>${esc(t.title)}</strong><span class="tr-muted">${esc(t.city_name || t.city_slug || '')} · ${day(t.starts_on)} to ${day(t.ends_on)} · ${esc(audienceWord(t.visibility))}</span></a></li>`).join('')}</ol>` : empty('No trip yet. Start with a city and two dates.', '/trips/new', 'Plan a trip')}
</div>`;
}

function tripPage({ trip, mine = false, canEdit = false, canShare = false, audience = null, cities = [], places = [], route = null, stays = [] } = {}) {
    const shareUrl = `/trips/${trip.slug}`;
    const audienceText = { public: 'Everyone', link: 'Anyone with the link', people: 'Specific people', private: 'Only me' };
    const who = audienceText[audience] || (trip.visibility === 'shared' ? 'Anyone with the link' : 'Only me');
    return `<div class="tr-wrap" id="tr-trip-page">
<nav class="crumbs" aria-label="Breadcrumbs"><a href="/trips">Trips</a> / ${esc(trip.title)}</nav>
<header class="tr-page-h"><p class="tr-kicker">${esc(trip.city_name || '')} · ${day(trip.starts_on)} to ${day(trip.ends_on)}</p><h1>${esc(trip.title)}</h1>
${trip.notes ? `<p class="tr-lede">${esc(trip.notes)}</p>` : ''}
<p class="tr-fine"><span class="tr-visibility">${esc(who)}</span>${mine ? '' : ' · you are reading a shared trip'} · last changed ${when(trip.updated_at)}</p>
${canShare ? `<p><button type="button" class="tr-btn tr-btn-quiet" data-ov-share-sheet data-kind="trip" data-id="${esc(trip.slug)}" data-title="${esc(trip.title)}">Share</button></p>` : ''}</header>
${canEdit ? `<section class="tr-sec tr-card"><h2>Share and edit</h2><p class="tr-muted">${who === 'Only me' ? 'Only you can read it.' : who === 'Anyone with the link' ? 'Anyone with this link can read it.' : who === 'Specific people' ? 'Only you and the people on the list can open it.' : 'Everyone can read it.'}</p><p><code>${esc(shareUrl)}</code></p>
<details class="tr-edit"><summary>Edit the name, city and dates</summary><form class="tr-form" method="post" action="/trips/${esc(trip.slug)}/edit">
<label class="tr-field"><span>Trip name</span><input name="title" value="${esc(trip.title)}" maxlength="120" required></label>
<label class="tr-field"><span>City</span><select name="city">${cities.map((c) => `<option value="${esc(c.slug)}"${c.id === trip.city_id ? ' selected' : ''}>${esc(c.name)}, ${esc(c.country)}</option>`).join('')}</select></label>
<label class="tr-field"><span>Starts</span><input type="date" name="starts_on" value="${esc(day(trip.starts_on))}" required></label>
<label class="tr-field"><span>Ends</span><input type="date" name="ends_on" value="${esc(day(trip.ends_on))}" required></label>
<label class="tr-field"><span>Notes</span><textarea name="notes" rows="3" maxlength="2000">${esc(trip.notes || '')}</textarea></label>
<button class="tr-btn" type="submit">Save the trip</button></form></details></section>` : ''}
<section class="tr-sec"><div class="tr-sec-head"><h2>Saved places</h2>${canEdit ? '' : `<span class="tr-muted">${places.length} places</span>`}</div>
${places.length ? `<ol class="tr-trip-places">${places.map((p) => `<li><span class="tr-stop-num" aria-hidden="true">${Number(p.position)}</span><div><a href="${esc(placePath(p))}"><strong>${esc(placeName(p))}</strong></a><span class="tr-muted">${localName(p) ? `${esc(localName(p))} · ` : ''}${esc(p.city_name)}${p.trip_note ? ` · ${esc(p.trip_note)}` : ''}</span>${canEdit ? `<form class="tr-inline-form" method="post" action="/trips/${esc(trip.slug)}/places/${esc(p.id)}/remove"><button class="tr-link-btn" type="submit">Remove</button></form>` : ''}</div></li>`).join('')}</ol>` : empty('No place saved yet. Open a city and a place, then save it here.', trip.city_slug ? `/city/${trip.city_slug}` : '/cities', 'Find places')}
${canEdit ? `<form class="tr-form tr-form-inline" method="post" action="/trips/${esc(trip.slug)}/places"><label class="tr-field"><span>Place id</span><input name="place_id" required placeholder="plc_…" pattern="plc_[0-9A-HJKMNP-TV-Z]{26}"></label><label class="tr-field"><span>Note</span><input name="note" maxlength="500"></label><button class="tr-btn" type="submit">Save place</button></form><p class="tr-fine">The place id is on the place page. In the API: POST /api/v1/trips/${esc(trip.slug)}/places.</p>` : ''}
</section>
<section class="tr-sec"><div class="tr-sec-head"><h2>Route</h2>${canEdit ? `<a class="tr-more" href="${trip.city_slug ? `/city/${trip.city_slug}` : '/routes'}">Find a route</a>` : ''}</div>
${route ? `<p><a href="/routes/${esc(route.id)}"><strong>${esc(route.title)}</strong></a> <span class="tr-muted">${Number(route.stop_count)} stops · ${km(route.distance_m)}</span></p>${canEdit ? `<form method="post" action="/trips/${esc(trip.slug)}/route"><input type="hidden" name="route_id" value=""><button class="tr-btn tr-btn-quiet" type="submit">Remove route</button></form>` : ''}` : `<p class="tr-muted">No route added${canEdit ? '. Open a route and press “Add to trip”.' : '.'}</p>`}
</section>
<section class="tr-sec"><div class="tr-sec-head"><h2>Stays</h2>${canEdit ? `<a class="tr-more" href="/stays">Find a stay</a>` : ''}</div>
${stays.length ? `<ol class="tr-stay-list">${stays.map((s0) => `<li><a href="${esc(s0.url)}" rel="noopener"><strong>${esc(s0.title)}</strong><span class="tr-muted">${money(s0.price, s0.currency)} / ${esc(s0.period)}</span></a>${canEdit ? `<form class="tr-inline-form" method="post" action="/trips/${esc(trip.slug)}/stays/${esc(s0.id)}/remove"><button class="tr-link-btn" type="submit">Remove</button></form>` : ''}</li>`).join('')}</ol>` : `<p class="tr-muted">No stay added${canEdit ? '. Open a stay and add it here.' : '.'}</p>`}
${canEdit ? `<form class="tr-form tr-form-inline" method="post" action="/trips/${esc(trip.slug)}/stays"><label class="tr-field"><span>Stay id</span><input name="stay_id" required placeholder="sty_…" pattern="sty_[0-9A-HJKMNP-TV-Z]{26}"></label><button class="tr-btn" type="submit">Add stay</button></form>` : ''}
</section>
${mine ? `<section class="tr-sec tr-card"><h2>Delete this trip</h2><form method="post" action="/trips/${esc(trip.slug)}/delete"><button class="tr-btn tr-btn-quiet" type="submit">Delete the trip</button></form><p class="tr-fine">This erases the trip and its saved places, route and stays. Places and routes themselves are public data and stay.</p></section>` : ''}
</div>`;
}

/**
 * The page a person not on a Specific-people trip's list sees: the audience, never the title, the places, the notes
 * or the route. openvibe-shared 4.123.0 draws the card from this markup (no inline script, so a strict CSP needs
 * nothing and every value is escaped like any other attribute).
 */
function tripGate({ slug, signedInAs = '', signInUrl = '/auth/login' } = {}) {
    return `<div class="tr-wrap tr-narrow tr-page-pad" id="tr-trip-gate">
<header class="tr-page-h"><p class="tr-kicker">Trips</p><h1>A trip shared with specific people</h1>
<p class="tr-lede">Sign in with the OpenVibe account it was shared with, or ask its owner for access.</p></header>
<div id="trip-share-gate" data-ov-share-gate data-kind="trip" data-id="${esc(slug)}" data-signed-in-as="${esc(signedInAs)}" data-sign-in-url="${esc(signInUrl)}">This is shared with specific people. Sign in with the OpenVibe account it was shared with, or ask its owner for access.</div>
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
        ['GET /api/v1/trips/:slug', 'your trip, or one shared with you', ''],
        ['PATCH /api/v1/trips/:slug', 'edit title, city, dates or notes (owner, or Specific people with Can edit); the audience is the Share sheet\'s', ''],
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

/** A city still being gathered on its first visit (the page refreshes itself; Refresh header). */
function gathering(name) {
    return `<div class="tr-wrap tr-page-pad tr-narrow" id="tr-gathering"><p class="tr-kicker">First visit</p><h1>Gathering ${esc(name)}</h1>
<p class="tr-lede">Its places are coming in from Wikivoyage, Wikidata and OpenStreetMap, with their photos and credits. This page reloads itself in a few seconds; the next visitor gets it at once.</p>
<p><a class="tr-btn tr-btn-quiet" href="/cities">Other cities</a></p></div>`;
}

function notFound() {
    return `<div class="tr-wrap tr-narrow tr-page-pad" id="tr-not-found"><p class="tr-kicker">404</p><h1>Not here</h1><p class="tr-lede">That city, place, route or trip does not exist, or it is a private trip.</p><p><a class="tr-btn" href="/">Go home</a> <a class="tr-btn tr-btn-quiet" href="/cities">Browse cities</a></p></div>`;
}

module.exports = { placeName, localName, kindUnlessNamed, HOME_FAQ, safeImage, home, citiesPage, cityPage, placePage, routePage, livePage, staysPage, flightsPage, signIn, tripNew, tripsPage, tripPage, tripGate, developersPage, gathering, notFound, placeOfDayCard, heroMotif, miniMap, SOURCE };
