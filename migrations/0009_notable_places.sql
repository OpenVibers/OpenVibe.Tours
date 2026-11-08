-- phase: expand
ALTER TABLE tours_places ADD COLUMN guide_why text;
ALTER TABLE tours_places DROP CONSTRAINT tours_places_osm_type;
ALTER TABLE tours_places ADD CONSTRAINT tours_places_osm_type CHECK (osm_type IN ('node', 'way', 'relation', 'wikivoyage', 'wikidata'));
CREATE TABLE tours_wikidata_city_places (
    city_id text COLLATE "C" PRIMARY KEY REFERENCES tours_cities(id) ON DELETE CASCADE,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL
);
