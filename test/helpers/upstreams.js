'use strict';

/**
 * In-process stand-ins for the open-data sources and the two network services Tours reads:
 *   /w/api.php action=parse          Wikivoyage
 *   /w/api.php action=query&prop=pageprops    Wikipedia
 *   /w/api.php action=wbgetentities  Wikidata
 *   /w/api.php action=query&prop=imageinfo    Commons
 *   /interpreter                     Overpass
 *   /api/streams, /api/streams/recent          OpenVibe.Live
 *   /api/v1/listings                 OpenVibe.Rent
 *
 * The fixtures are small and deterministic; a test changes state.pages/state.streams/state.listings and reads
 * state.requests (headers included) to check the User-Agent, the query and the fetch time.
 */
const http = require('http');

const WIKIVOYAGE = {
    Tokyo: `'''Tokyo''' is the capital of Japan and one of the world's great cities. It mixes quiet shrines with dense neighbourhoods, and the trains go everywhere.

==See==
{{see | name=Senso-ji | lat=35.7148 | long=139.7967 | content=A temple in Asakusa, busy at every hour.}}
{{see | name=Meiji Shrine | lat=35.6764 | long=139.6993 | content=A Shinto shrine in a forest beside Harajuku.}}
{{see | name=Tokyo Skytree | lat=35.7101 | long=139.8107 | content=A tall tower with a view over the city.}}
{{see | name=Ueno Park | lat=35.7156 | long=139.7745 | content=Museums, a pond and cherry trees.}}
{{see | name=Tsukiji Outer Market | lat=35.6655 | long=139.7708 | content=Street food and knives.}}
{{see | name=Shinjuku Gyoen | lat=35.6852 | long=139.7101 | content=A garden for a slow afternoon.}}
`,
    Delhi: `'''Delhi''' is India's capital, a city of old lanes, Mughal monuments and wide new avenues.

==See==
{{see | name=Red Fort | lat=28.6562 | long=77.2410 | content=The Mughal fort in Old Delhi.}}
{{see | name=Humayun's Tomb | lat=28.5933 | long=77.2507 | content=A garden tomb that inspired the Taj Mahal.}}
{{see | name=Qutub Minar | lat=28.5245 | long=77.1855 | content=A minaret and a complex of ruins.}}
{{see | name=India Gate | lat=28.6129 | long=77.2295 | content=The war memorial at the end of Rajpath.}}
{{see | name=Lotus Temple | lat=28.5535 | long=77.2588 | content=A Bahá'í house of worship.}}
{{see | name=Chandni Chowk | lat=28.6507 | long=77.2300 | content=The old market lanes.}}
`,
    Shanghai: `'''Shanghai''' is China's largest city, with a riverfront of colonial banks and a skyline of towers.

==See==
{{see | name=The Bund | lat=31.2400 | long=121.4900 | content=The riverfront walk and its old banks.}}
{{see | name=Yu Garden | lat=31.2272 | long=121.4921 | content=A Ming garden in the old city.}}
{{see | name=Shanghai Museum | lat=31.2303 | long=121.4706 | content=Bronzes, ceramics and calligraphy.}}
{{see | name=Jing'an Temple | lat=31.2231 | long=121.4453 | content=A Buddhist temple among the towers.}}
{{see | name=Tianzifang | lat=31.2088 | long=121.4669 | content=Lanes of studios and small shops.}}
{{see | name=Longhua Temple | lat=31.1786 | long=121.4453 | content=The oldest temple in the city.}}
`,
    Lisbon: `'''Lisbon''' is Portugal's capital, built on seven hills above the River Tagus. Trams climb between viewpoints, tiled façades and old neighbourhoods.

==See==
{{SeeDistricts}}
===[[Lisbon/Alfama|Alfama]]===
The oldest quarter, climbed by tram and on foot.
`,
    'Lisbon/Alfama': `'''Alfama''' is Lisbon's oldest quarter.

==See==
{{see | name=Castelo de São Jorge | lat=38.7139 | long=-9.1335 | content=A castle above the city with a wide view.}}
{{see | name=Lisbon Cathedral | lat=38.7098 | long=-9.1330 | content=The Romanesque cathedral.}}
{{see | name=Miradouro de Santa Luzia | lat=38.7118 | long=-9.1300 | content=A viewpoint with azulejos and a garden.}}
{{see | name=Miradouro da Senhora do Monte | lat=38.7190 | long=-9.1328 | content=The highest viewpoint in the old city.}}
{{see | name=Museu do Teatro Romano | lat=38.7105 | long=-9.1324 | content=The remains of a Roman theatre.}}
{{see | name=Panteão Nacional | lat=38.7150 | long=-9.1250 | content=The domed national pantheon.}}
`,
    Paris: `'''Paris''' is the capital of France, a walkable city of boulevards, museums and riverbanks.

==See==
{{see | name=Eiffel Tower | lat=48.8584 | long=2.2945 | content=The tower on the Champ de Mars.}}
{{see | name=Louvre Museum | lat=48.8606 | long=2.3376 | content=The museum in the old palace.}}
{{see | name=Notre-Dame | lat=48.8530 | long=2.3499 | content=The cathedral on the Île de la Cité.}}
{{see | name=Montmartre | lat=48.8867 | long=2.3431 | content=The hill and the basilica.}}
{{see | name=Jardin du Luxembourg | lat=48.8462 | long=2.3371 | content=A garden for an afternoon.}}
{{see | name=Musée d'Orsay | lat=48.8600 | long=2.3266 | content=Impressionists in a former station.}}
`,
    Barcelona: `'''Barcelona''' is a Mediterranean city of Gothic lanes and modernista buildings.

==See==
{{see | name=Sagrada Família | lat=41.4036 | long=2.1744 | content=Gaudí's unfinished basilica.}}
{{see | name=Park Güell | lat=41.4145 | long=2.1527 | content=Mosaics and terraces above the city.}}
{{see | name=Gothic Quarter | lat=41.3839 | long=2.1762 | content=The old streets and the cathedral.}}
{{see | name=Casa Batlló | lat=41.3916 | long=2.1649 | content=A modernista house on Passeig de Gràcia.}}
{{see | name=La Boqueria | lat=41.3817 | long=2.1717 | content=The market off La Rambla.}}
{{see | name=Barceloneta | lat=41.3784 | long=2.1925 | content=The beach and the seafood.}}
`,
};

const ENTITIES = {
    Q1490: { label: 'Tokyo', lat: 35.6762, lon: 139.6503, population: 13960000, image: 'File:Tokyo test.jpg', country: 'Q17', sitelink: 'Tokyo' },
    Q1353: { label: 'Delhi', lat: 28.6139, lon: 77.2090, population: 16787941, image: 'File:Delhi test.jpg', country: 'Q668', sitelink: 'Delhi' },
    Q8686: { label: 'Shanghai', lat: 31.2304, lon: 121.4737, population: 24870895, image: 'File:Shanghai test.jpg', country: 'Q148', sitelink: 'Shanghai' },
    Q597: { label: 'Lisbon', lat: 38.7223, lon: -9.1393, population: 545923, image: 'File:Lisbon test.jpg', country: 'Q45', sitelink: 'Lisbon' },
    Q90: { label: 'Paris', lat: 48.8566, lon: 2.3522, population: 2140526, image: 'File:Paris test.jpg', country: 'Q142', sitelink: 'Paris' },
    Q1492: { label: 'Barcelona', lat: 41.3874, lon: 2.1686, population: 1620343, image: 'File:Barcelona test.jpg', country: 'Q29', sitelink: 'Barcelona' },
};
const COUNTRIES = { Q17: { label: 'Japan', code: 'JP' }, Q668: { label: 'India', code: 'IN' }, Q148: { label: 'China', code: 'CN' }, Q45: { label: 'Portugal', code: 'PT' }, Q142: { label: 'France', code: 'FR' }, Q29: { label: 'Spain', code: 'ES' } };
const TITLE_QID = { Tokyo: 'Q1490', Delhi: 'Q1353', Shanghai: 'Q8686', Lisbon: 'Q597', Paris: 'Q90', Barcelona: 'Q1492', 'New York City': 'Q60' };

const LIVE = {
    streams: [{ id: 1, username: 'ada', display_name: 'Ada', title: 'IRL walk in Lisbon', category: 'irl', tags: '[]', viewer_count: 12, thumbnail_url: null, started_at: '2026-10-31 10:00:00' }],
    recent: [{ id: 2, username: 'bo', display_name: 'Bo', title: 'IRL tour of Paris', category: 'travel', tags: '["irl"]', viewer_count: 0, thumbnail_url: null, started_at: '2026-10-30 09:00:00', ended_at: '2026-10-30 10:00:00', vod_id: 77, vod_thumbnail_url: null }],
    clips: [{ id: 5, username: 'ada', display_name: 'Ada', title: 'IRL market walk in Lisbon', view_count: 40, thumbnail_url: null, created_at: '2026-10-29 12:00:00', vod_id: 6118 }],
};
const LISTINGS = [{ id: 'rnt_01JABCDEFGHJKMNPQRSTVWXYZ0', kind: 'apartment', title: 'A flat in Alfama', description: 'A small flat.', price: 1200, currency: 'EUR', period: 'month', city: 'Lisbon', country: 'PT', neighbourhood: 'Alfama', bedrooms: 1 }];

function listen(handler) {
    return new Promise((resolve) => {
        const sockets = new Set();
        const server = http.createServer((req, res) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                const json = (status, obj, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
                Promise.resolve(handler(req, raw, json, res)).catch((err) => json(500, { error: String(err && err.message) }));
            });
        });
        server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
        server.listen(0, '127.0.0.1', () => resolve({
            server, url: `http://127.0.0.1:${server.address().port}`,
            close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }),
        }));
    });
}

async function startUpstreams() {
    const state = {
        pages: JSON.parse(JSON.stringify(WIKIVOYAGE)),
        streams: JSON.parse(JSON.stringify(LIVE.streams)),
        recent: JSON.parse(JSON.stringify(LIVE.recent)),
        clips: JSON.parse(JSON.stringify(LIVE.clips)),
        listings: JSON.parse(JSON.stringify(LISTINGS)),
        overpass: null,
        down: {},
        requests: [],
    };

    const srv = await listen(async (req, raw, json) => {
        const url = new URL(req.url, 'http://x');
        state.requests.push({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, body: raw });
        if (state.down[url.pathname] || state.down.all) return json(503, { error: 'source down' });

        if (url.pathname === '/w/api.php') {
            const action = url.searchParams.get('action');
            if (action === 'parse') {
                const title = url.searchParams.get('page');
                const text = state.pages[title];
                if (!text) return json(200, { error: { code: 'missingtitle', info: 'no such page' } });
                return json(200, { parse: { title, pageid: 1, revid: 2, wikitext: text } });
            }
            if (action === 'query' && url.searchParams.get('prop') === 'pageprops') {
                const titles = String(url.searchParams.get('titles') || '').split('|');
                const pages = titles.filter((t) => TITLE_QID[t]).map((t) => ({ title: t, pageprops: { wikibase_item: TITLE_QID[t] } }));
                return json(200, { query: { pages } });
            }
            if (action === 'query' && url.searchParams.get('list') === 'search') {
                const q = String(url.searchParams.get('srsearch') || '');
                const hit = Object.keys(state.pages).find((p) => p.toLowerCase().includes(q.toLowerCase()));
                return json(200, { query: { search: hit ? [{ title: hit }] : [] } });
            }
            if (action === 'wbgetentities') {
                const ids = String(url.searchParams.get('ids') || '').split('|');
                const entities = {};
                for (const id of ids) {
                    const e = ENTITIES[id];
                    if (e) {
                        entities[id] = {
                            id, labels: { en: { language: 'en', value: e.label } },
                            claims: {
                                P625: [{ mainsnak: { datavalue: { value: { latitude: e.lat, longitude: e.lon } } } }],
                                P1082: [{ mainsnak: { datavalue: { value: { amount: `+${e.population}` } } } }],
                                P18: [{ mainsnak: { datavalue: { value: e.image } } }],
                                P17: [{ mainsnak: { datavalue: { value: { id: e.country } } } }],
                            },
                            sitelinks: { enwikivoyage: { title: e.sitelink } },
                        };
                    } else if (COUNTRIES[id]) {
                        entities[id] = { id, labels: { en: { language: 'en', value: COUNTRIES[id].label } }, claims: { P297: [{ mainsnak: { datavalue: { value: COUNTRIES[id].code } } }] } };
                    }
                }
                return json(200, { entities });
            }
            if (action === 'query' && url.searchParams.get('prop') === 'imageinfo') {
                const titles = String(url.searchParams.get('titles') || '').split('|');
                const pages = titles.map((t) => ({ title: t, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/tours-test.jpg', url: 'https://upload.wikimedia.org/tours-test.jpg', extmetadata: { Artist: { value: 'A photographer' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' } } }] }));
                return json(200, { query: { pages } });
            }
            return json(400, { error: 'unknown action' });
        }

        if (url.pathname === '/interpreter' && req.method === 'POST') {
            const decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
            const m = /around:(\d+),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(decoded);
            const lat = m ? Number(m[2]) : 35.6762;
            const lon = m ? Number(m[3]) : 139.6503;
            const named = [
                { at: [35.6762, 139.6503], id: 21, name: 'Senso-ji', lat: 35.7148, lon: 139.7967 },
                { at: [28.6139, 77.2090], id: 22, name: 'Red Fort', lat: 28.6562, lon: 77.2410 },
                { at: [31.2304, 121.4737], id: 23, name: 'The Bund', lat: 31.2400, lon: 121.4900 },
                { at: [38.7223, -9.1393], id: 24, name: 'Castelo de São Jorge', lat: 38.7139, lon: -9.1335 },
                { at: [48.8566, 2.3522], id: 25, name: 'Eiffel Tower', lat: 48.8584, lon: 2.2945 },
                { at: [41.3874, 2.1686], id: 26, name: 'Sagrada Família', lat: 41.4036, lon: 2.1744 },
            ].find((x) => Math.abs(x.at[0] - lat) < 0.2 && Math.abs(x.at[1] - lon) < 0.2);
            const extra = named ? [{ type: 'node', id: named.id, lat: named.lat, lon: named.lon, tags: { name: named.name, tourism: 'attraction', wikidata: 'Q3' } }] : [];
            const seed = 100000 + Math.round((Math.abs(lat) * 1000 + Math.abs(lon) * 10)) * 10;
            const base = state.overpass || [
                ...extra,
                { type: 'node', id: seed + 1, lat: lat + 0.002, lon: lon + 0.002, tags: { name: 'Museum of the city', tourism: 'museum', wheelchair: 'yes', opening_hours: 'Tu-Su 10:00-18:00', website: 'https://museum.example/', wikidata: 'Q1' } },
                { type: 'node', id: seed + 2, lat: lat + 0.004, lon: lon - 0.002, tags: { name: 'The old tower', tourism: 'attraction', fee: 'no', wikidata: 'Q2' } },
                { type: 'way', id: seed + 3, center: { lat: lat - 0.003, lon: lon + 0.001 }, tags: { name: 'City park', tourism: 'attraction', fee: 'no' } },
                { type: 'node', id: seed + 4, lat: lat - 0.001, lon: lon - 0.004, tags: { name: 'Hotel not a place', tourism: 'hotel' } },
            ];
            return json(200, { elements: base });
        }

        if (url.pathname === '/api/streams') return json(200, { streams: state.streams });
        if (url.pathname === '/api/streams/recent') return json(200, { streams: state.recent });
        if (url.pathname === '/api/clips') return json(200, { clips: state.clips });
        if (url.pathname === '/api/v1/listings') {
            const city = url.searchParams.get('city');
            const limit = Number(url.searchParams.get('limit') || 30);
            const rows = state.listings.filter((l) => !city || l.city.toLowerCase() === city.toLowerCase()).slice(0, limit);
            return json(200, { count: rows.length, listings: rows, facets: { kind: [], country: [] }, next: null });
        }
        return json(404, { error: 'not found' });
    });
    return { url: srv.url, state, close: srv.close };
}

module.exports = { startUpstreams, WIKIVOYAGE, ENTITIES, COUNTRIES, LIVE, LISTINGS };
