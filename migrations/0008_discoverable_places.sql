-- phase: expand
-- Source checked images and cached city name resolutions.
ALTER TABLE tours_places ADD COLUMN image_license_url text;
ALTER TABLE tours_places ADD COLUMN image_source_url text;
ALTER TABLE tours_places ADD COLUMN gallery jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tours_places ADD COLUMN rank_score integer NOT NULL DEFAULT 0;
ALTER TABLE tours_places ADD COLUMN guide_features text;
ALTER TABLE tours_places ADD COLUMN guide_visit text;
ALTER TABLE tours_places ADD COLUMN guide_season text;
ALTER TABLE tours_places DROP CONSTRAINT tours_places_source;
ALTER TABLE tours_places ADD CONSTRAINT tours_places_source CHECK (source IN ('openstreetmap', 'wikivoyage', 'wikidata', 'wikipedia'));
ALTER TABLE tours_cities ADD COLUMN image_source_url text;
ALTER TABLE tours_cities ADD COLUMN osm_attempted_at timestamptz;
ALTER TABLE tours_live ADD COLUMN place_id text COLLATE "C" REFERENCES tours_places(id) ON DELETE SET NULL;
CREATE INDEX tours_live_place ON tours_live (place_id, fetched_at DESC) WHERE place_id IS NOT NULL;
CREATE TABLE tours_city_lookup (
    query text COLLATE "C" PRIMARY KEY,
    city_id text COLLATE "C" REFERENCES tours_cities(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);
CREATE TABLE tours_photo_assets (
    source_url text COLLATE "C" PRIMARY KEY,
    media_id text COLLATE "C" NOT NULL,
    media_url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tours_pageview_cache (
    wikipedia_title text COLLATE "C" PRIMARY KEY,
    views integer NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tours_place_summaries (
    place_id text COLLATE "C" PRIMARY KEY REFERENCES tours_places(id) ON DELETE CASCADE,
    source_fetched_at timestamptz NOT NULL,
    summary text NOT NULL,
    run_id text COLLATE "C" NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
