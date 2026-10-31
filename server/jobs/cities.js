'use strict';

/**
 * The cities job: the top 100 cities from the catalogue, resolved to Wikidata (coordinates, population, image,
 * country, the English Wikivoyage sitelink), their image licence from Commons, and their Wikivoyage page (lead
 * summary plus the See listings routes are generated from). Each row keeps its source URL and fetch time.
 *
 * If a city's Wikivoyage page is districted and the city page has too few See listings with coordinates, the job
 * fetches up to TOURS_WIKIVOYAGE_DISTRICTS district pages linked from it. The stored source is the JSON of those
 * pages, so the routes job can cite the exact page of every stop.
 */
const fs = require('fs');
const path = require('path');
const { createWikivoyage } = require('../sources/wikivoyage-client');
const { createWikidata } = require('../sources/wikidata');
const { parseCityPage, pageUrl } = require('../sources/wikivoyage');
const { slugify } = require('../store');

const CATALOG = path.join(__dirname, '..', '..', 'data', 'top-cities.json');

function loadCatalog(limit = 100) {
    const rows = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
    return rows.slice(0, Math.max(1, Math.min(rows.length, Number(limit) || rows.length)));
}

function fileTitle(name) {
    const s = String(name || '').trim();
    if (!s) return null;
    return /^File:/i.test(s) ? s : `File:${s}`;
}

function createCitiesJob({ config, s, store, fetchImpl, log = console }) {
    const wikivoyage = createWikivoyage({ config, fetchImpl, pace: s.pace });
    const wikidata = createWikidata({ config, fetchImpl, pace: s.pace, log });

    async function runOnce({ limit = config.openData.cityLimit } = {}) {
        const catalog = loadCatalog(limit);
        const result = { catalog: catalog.length, cities: 0, withSummary: 0, withSee: 0, districts: 0, skipped: [], errors: [] };

        const qidMap = await wikidata.resolveQids(catalog.map((c) => c.wikipedia || c.name));
        const qids = [...qidMap.values()].map((v) => v.qid);
        const entities = await wikidata.entities(qids);
        const countryQids = [...new Set([...entities.values()].map((e) => e.countryQid).filter(Boolean))];
        const countries = await wikidata.countryInfo(countryQids);
        const imageFiles = [...new Set([...entities.values()].map((e) => fileTitle(e.image)).filter(Boolean))];
        const images = await wikidata.imageInfo(imageFiles);

        for (const [i, entry] of catalog.entries()) {
            const resolved = qidMap.get(entry.wikipedia || entry.name);
            if (!resolved) { result.skipped.push(entry.name); continue; }
            const entity = entities.get(resolved.qid);
            if (!entity || entity.lat == null || entity.lon == null) { result.skipped.push(entry.name); continue; }
            const country = countries.get(entity.countryQid) || { label: entry.country, code: null };
            const image = images.get(fileTitle(entity.image));
            const title = entry.wikivoyage || entity.wikivoyageTitle || entry.name;
            const name = entity.label || entry.name;
            const city = {
                name,
                country: country.label || entry.country,
                countryCode: country.code || null,
                lat: entity.lat,
                lon: entity.lon,
                population: entity.population,
                wikidataId: entity.qid,
                wikipediaTitle: entry.wikipedia || entry.name,
                wikivoyageTitle: title,
                slug: slugify(name),
                imageUrl: image ? image.url : null,
                imageCredit: image ? image.credit : null,
                imageLicense: image ? image.license : null,
                imageLicenseUrl: image ? image.licenseUrl : null,
                source: 'wikidata',
                sourceUrl: `https://www.wikidata.org/wiki/${entity.qid}`,
                fetchedAt: entity.fetchedAt || s.now(),
                summary: null,
            };
            const cityId = await store.upsertCity(city);

            // Wikivoyage: the page, its summary and its See listings; districts only when needed.
            let main = null;
            try {
                main = await wikivoyage.page(title);
                if (!main && title !== entry.name) main = await wikivoyage.page(entry.name);
                if (!main) {
                    const found = await wikivoyage.search(entry.name);
                    if (found) main = await wikivoyage.page(found);
                }
            } catch (err) {
                result.errors.push(`${entry.name}: Wikivoyage ${err && err.message}`);
            }
            if (main) {
                const parsed = parseCityPage(main.wikitext, main.title, { districts: config.openData.districtPages });
                const pages = [{ title: main.title, wikitext: main.wikitext, sourceUrl: main.sourceUrl, fetchedAt: main.fetchedAt }];
                let see = parsed.see.map((x) => ({ ...x, pageUrl: main.sourceUrl }));
                if (see.filter((x) => x.hasCoords).length < 4) {
                    for (const district of parsed.districts.slice(0, config.openData.districtPages)) {
                        try {
                            const sub = await wikivoyage.page(district);
                            if (!sub) continue;
                            const subParsed = parseCityPage(sub.wikitext, sub.title, { districts: 0 });
                            see = see.concat(subParsed.see.map((x) => ({ ...x, pageUrl: sub.sourceUrl })));
                            pages.push({ title: sub.title, wikitext: sub.wikitext, sourceUrl: sub.sourceUrl, fetchedAt: sub.fetchedAt });
                            result.districts += 1;
                        } catch (err) {
                            result.errors.push(`${entry.name}/${district}: ${err && err.message}`);
                        }
                    }
                }
                // One listing per name+coordinate, in page order.
                const seen = new Set();
                see = see.filter((x) => {
                    const key = `${x.name.toLowerCase()}|${x.lat == null ? '' : x.lat}|${x.lon == null ? '' : x.lon}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                const summary = parsed.summary || null;
                if (summary) {
                    await store.upsertCity({ ...city, summary, source: 'wikivoyage', sourceUrl: main.sourceUrl, fetchedAt: main.fetchedAt });
                    result.withSummary += 1;
                }
                if (see.some((x) => x.hasCoords)) result.withSee += 1;
                await store.upsertCitySource(cityId, {
                    wikivoyageTitle: main.title,
                    wikitext: JSON.stringify({ pages, see }),
                    sourceUrl: main.sourceUrl,
                    fetchedAt: main.fetchedAt,
                });
            }
            result.cities += 1;
            if ((i + 1) % 10 === 0) log.log(`[Tours cities] ${i + 1}/${catalog.length} (${result.cities} cities)`);
        }
        return result;
    }

    return { runOnce, loadCatalog, pageUrl };
}

module.exports = { createCitiesJob, loadCatalog };
