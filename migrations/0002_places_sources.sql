-- phase: expand
-- Wikivoyage places (CC BY-SA) sit beside OpenStreetMap places, and OSM refreshes are rotated a few cities per run
-- so one job never hammers the public Overpass instance. Clips are a third Live kind (openvibe.video/c/<id>).

ALTER TABLE tours_cities ADD COLUMN osm_fetched_at timestamptz;

ALTER TABLE tours_places DROP CONSTRAINT tours_places_osm_type;
ALTER TABLE tours_places ADD CONSTRAINT tours_places_osm_type CHECK (osm_type IN ('node', 'way', 'relation', 'wikivoyage'));
ALTER TABLE tours_places DROP CONSTRAINT tours_places_osm_id;
ALTER TABLE tours_places ADD CONSTRAINT tours_places_osm_id CHECK (osm_id ~ '^[A-Za-z0-9:_-]{1,64}$');

ALTER TABLE tours_live DROP CONSTRAINT tours_live_kind;
ALTER TABLE tours_live ADD CONSTRAINT tours_live_kind CHECK (kind IN ('stream', 'vod', 'clip'));
