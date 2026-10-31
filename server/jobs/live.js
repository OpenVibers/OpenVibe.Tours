'use strict';

/**
 * The live job: OpenVibe.Live's public stream list (IRL now) and recent IRL VODs. Live publishes no location, so a
 * city is attached only when the stream's title or tags plainly name a Tour city; otherwise city_id stays NULL and
 * the item still appears under "Live tours now". No follow, no chat write, no token.
 */
const { createLive } = require('../sources/live');

function cityMatcher(cities) {
    const names = cities.map((c) => ({ id: c.id, name: c.name, re: new RegExp(`(^|[^\\p{L}])${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'iu') }))
        .sort((a, b) => b.name.length - a.name.length);
    return (text) => names.find((n) => n.re.test(text)) || null;
}

function createLiveJob({ config, s, store, fetchImpl, log = console }) {
    const live = createLive({ config, fetchImpl, pace: s.pace });

    async function runOnce() {
        const cities = await store.listCities({ limit: 200 });
        const match = cityMatcher(cities);
        const result = { streams: 0, vods: 0, clips: 0, withCity: 0, errors: [] };
        let streams = [];
        let recent = [];
        let clips = [];
        try { streams = (await live.streams()).streams; } catch (err) { result.errors.push(`streams: ${err && err.message}`); }
        try { recent = (await live.recent(50)).streams; } catch (err) { result.errors.push(`recent: ${err && err.message}`); }
        try { clips = (await live.clips(50)).clips; } catch (err) { result.errors.push(`clips: ${err && err.message}`); }

        // Replace the live list only when the list answered: never empty it because the source was down.
        if (!result.errors.some((e) => e.startsWith('streams:'))) {
            await store.clearLiveStreams();
            for (const item of streams) {
                const city = match(`${item.title} ${item.tags.join(' ')}`);
                await store.upsertLive({ ...item, cityId: city ? city.id : null, cityName: city ? city.name : null });
                result.streams += 1;
                if (city) result.withCity += 1;
            }
        }
        for (const item of recent) {
            const city = match(`${item.title} ${item.tags.join(' ')}`);
            await store.upsertLive({ ...item, cityId: city ? city.id : null, cityName: city ? city.name : null });
            result.vods += 1;
            if (city) result.withCity += 1;
        }
        for (const item of clips) {
            const city = match(`${item.title} `);
            await store.upsertLive({ ...item, cityId: city ? city.id : null, cityName: city ? city.name : null });
            result.clips += 1;
            if (city) result.withCity += 1;
        }
        await store.trimLiveVods(200);
        return result;
    }

    return { runOnce };
}

module.exports = { createLiveJob, cityMatcher };
