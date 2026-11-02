-- phase: expand
-- A place's English name from OpenStreetMap (name:en) beside its own (name). 252 places in Tokyo, Shanghai, Tianjin,
-- Guangzhou, Beijing and Chongqing had a name in Chinese or Japanese script only, so an English search never found
-- them (2026-11-02: "Hongya Cave" is 洪崖洞). The cities those places are in are marked for an OpenStreetMap refresh, so
-- the next places run (it runs at boot: its version changed) fetches their English names first.

ALTER TABLE tours_places ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE tours_places ADD CONSTRAINT tours_places_name_en CHECK (name_en IS NULL OR length(name_en) BETWEEN 1 AND 200);

UPDATE tours_cities SET osm_fetched_at = NULL
 WHERE id IN (SELECT DISTINCT city_id FROM tours_places WHERE source = 'openstreetmap' AND name !~ '[A-Za-zÀ-ɏ]');
