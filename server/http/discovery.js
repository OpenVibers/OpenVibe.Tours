'use strict';

/**
 * Crawl artifacts for openvibe.tours: robots.txt, sitemap.xml, llms.txt and llms-full.txt. Public cities, places and
 * routes are for search engines and language models; sign-in, the API, a trip (private or shared) and the internal
 * routes are not.
 */
const fs = require('fs');
const path = require('path');
const seo = require('openvibe-shared/seo');
const cache = require('openvibe-shared/cache-policy');
const { asyncRouter } = require('./router');

const SITE_NAME = 'OpenVibe.Tours';
const DESCRIPTION = 'OpenVibe.Tours is go anywhere: fly, stay, walk, watch. Cities, places and self-guided routes from OpenStreetMap, Wikivoyage and Wikidata; IRL tours live on OpenVibe.Live; stays from OpenVibe.Rent; flights through the official airline-neutral search; and trips a person can share read-only.';
const DISALLOW = ['/auth/', '/api/', '/internal', '/metrics', '/trips'];

const dayOf = (ts) => { const m = String(ts == null ? '' : ts).match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };
function siteUpdated() {
    try { return dayOf(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'STATUS.json'), 'utf8')).updated); } catch { return null; }
}

function homeJsonLd(config) {
    const site = String(config.baseUrl).replace(/\/+$/, '');
    return [
        seo.jsonLd.website({ name: SITE_NAME, url: site, description: DESCRIPTION, searchUrl: `${site}/cities?q={q}` }),
        seo.jsonLd.softwareApp({ name: SITE_NAME, url: site, description: DESCRIPTION, category: 'TravelApplication', keywords: 'openvibe tours, travel, places, self-guided routes, live tours, stays, flights, openstreetmap, wikivoyage, wikidata' }),
        seo.jsonLd.webPage({ name: SITE_NAME, url: `${site}/`, description: DESCRIPTION, siteUrl: site }),
        seo.jsonLd.faq([
            { q: 'Where does OpenVibe.Tours get its data?', a: 'OpenStreetMap (ODbL), Wikivoyage (CC BY-SA), Wikidata (CC0), OpenVibe.Live\'s public stream list and OpenVibe.Rent\'s public listings. Every item carries its source and the time it was fetched.' },
            { q: 'Are the routes guided tours?', a: 'No. They are self-guided walks generated from Wikivoyage See lists and marked as generated, with a cited note at every stop.' },
            { q: 'Does OpenVibe.Tours sell flights or stays?', a: 'No. There is no flight API key in v1: the flight form links the official airline-neutral search with no affiliate parameter. Stays link to OpenVibe.Rent; no payment is handled on Tours.' },
        ]),
    ];
}

function publicPages() {
    return [
        { path: '/', changefreq: 'daily', priority: 1.0, title: 'OpenVibe.Tours home', text: 'Go anywhere: fly, stay, walk, watch.' },
        { path: '/cities', changefreq: 'daily', priority: 0.9, title: 'Cities', text: 'The top 100 cities from Wikidata and Wikivoyage.' },
        { path: '/routes', changefreq: 'daily', priority: 0.9, title: 'Self-guided routes', text: 'Walks generated from Wikivoyage See lists, with cited stops and OpenStreetMap maps.' },
        { path: '/live', changefreq: 'hourly', priority: 0.8, title: 'Live tours now', text: 'IRL tours live on OpenVibe.Live.' },
        { path: '/stays', changefreq: 'daily', priority: 0.7, title: 'Stays', text: 'Active rentals from OpenVibe.Rent.' },
        { path: '/flights', changefreq: 'weekly', priority: 0.6, title: 'Flights', text: 'The official airline-neutral flight search, with no affiliate.' },
        { path: '/developers', changefreq: 'weekly', priority: 0.5, title: 'The OpenVibe.Tours API', text: 'The JSON API, the OpenAPI document, and the sources behind every place.' },
    ];
}

function createDiscoveryRoutes(ctx) {
    const { config, store } = ctx;
    const r = asyncRouter();
    const site = String(config.baseUrl).replace(/\/+$/, '');
    const abs = (p) => `${site}${p}`;
    const TEXT = cache.htmlHeaders({ maxAge: 3600 });
    const pages = publicPages();

    r.get('/robots.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(
            '# openvibe.tours: public cities, places and routes are for search engines; sign-in, the API and trips are not.\n'
            + seo.robotsTxt({ sitemaps: [abs('/sitemap.xml')], disallow: DISALLOW }));
    });

    r.get('/llms.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsTxt({
            name: SITE_NAME,
            summary: DESCRIPTION,
            details: 'GET /api/v1/cities?limit=&offset=&q= lists the top cities; GET /api/v1/cities/:slug adds its places, routes, live tours and stays. GET /api/v1/places/:id and GET /api/v1/routes/:id return one place or one route with its ordered stops. GET /api/v1/live returns IRL tours now and recent IRL VODs. Trips are a signed-in person\'s own: the tours_at session cookie or a Network Bearer token. Every place is OpenStreetMap (ODbL) with its osm.org link and fetch time; route stops cite the Wikivoyage page (CC BY-SA); city images say their Commons licence. No route needs a service token. Flights have no API key in v1; the form only links the official airline-neutral search, with no affiliate.',
            sections: [
                { title: 'Start here', links: [
                    { title: 'OpenVibe.Tours', url: abs('/'), note: 'go anywhere: fly, stay, walk, watch' },
                    { title: 'Cities', url: abs('/cities') },
                    { title: 'Routes', url: abs('/routes') },
                    { title: 'Live tours', url: abs('/live') },
                    { title: 'The API', url: abs('/developers') },
                    { title: 'OpenAPI', url: abs('/api/v1/openapi.json') },
                ] },
                { title: 'Machine-readable', links: [
                    { title: 'Cities (JSON)', url: abs('/api/v1/cities') },
                    { title: 'Live (JSON)', url: abs('/api/v1/live') },
                    { title: 'Sitemap', url: abs('/sitemap.xml') },
                    { title: 'Full text for language models', url: abs('/llms-full.txt') },
                    { title: 'Release metadata (JSON)', url: abs('/release.json') },
                ] },
                { title: 'Elsewhere', links: [
                    { title: 'OpenVibe.Live', url: 'https://openvibe.live', note: 'the IRL streams' },
                    { title: 'OpenVibe.Rent', url: 'https://openvibe.rent', note: 'the listings' },
                    { title: 'OpenVibe.Network', url: 'https://openvibe.network', note: 'accounts and sign-in' },
                ] },
            ],
        }));
    });

    r.get('/llms-full.txt', async (_req, res) => {
        const [cities, routes, places] = await Promise.all([
            store.publicCitiesForLlms(200), store.publicRoutesForSitemap(500), store.publicPlacesForSitemap(5000),
        ]);
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsFull({
            site: SITE_NAME,
            summary: 'Every public city, route and place page on OpenVibe.Tours, from OpenStreetMap, Wikivoyage and Wikidata.',
            base: site, maxBytes: 512 * 1024,
            sections: [
                { title: 'Pages', pages: pages.map((p) => ({ url: p.path, title: p.title, text: p.text })) },
                { title: 'Cities', pages: cities.map((c) => ({ url: `/city/${c.slug}`, title: c.name, text: [c.country, c.summary].filter(Boolean).join(' · ') })) },
                { title: 'Routes', pages: routes.map((r0) => ({ url: `/routes/${r0.id}`, title: 'Self-guided route', text: 'Generated from a Wikivoyage See list.' })) },
                { title: 'Places', pages: places.map((p) => ({ url: `/place/${p.id}`, title: 'Place', text: 'From OpenStreetMap, ODbL.' })) },
            ],
        }));
    });

    r.get('/sitemap.xml', async (_req, res) => {
        const lastmod = siteUpdated();
        const [cities, routes, places] = await Promise.all([
            store.publicCitiesForSitemap(500), store.publicRoutesForSitemap(5000), store.publicPlacesForSitemap(20000),
        ]);
        const urls = [
            ...pages.map((e) => ({ loc: abs(e.path), ...(lastmod ? { lastmod } : {}), changefreq: e.changefreq, priority: e.priority })),
            ...cities.map((e) => ({ loc: abs(`/city/${e.slug}`), lastmod: dayOf(e.updated_at) || lastmod, changefreq: 'weekly', priority: 0.8 })),
            ...routes.map((e) => ({ loc: abs(`/routes/${e.id}`), lastmod: dayOf(e.updated_at) || lastmod, changefreq: 'weekly', priority: 0.6 })),
            ...places.map((e) => ({ loc: abs(`/place/${e.id}`), lastmod: dayOf(e.updated_at) || lastmod, changefreq: 'monthly', priority: 0.4 })),
        ];
        res.type('application/xml').set('Cache-Control', TEXT).send(seo.sitemapXml(urls));
    });

    return r;
}

module.exports = { createDiscoveryRoutes, homeJsonLd, publicPages, DESCRIPTION, SITE_NAME };
