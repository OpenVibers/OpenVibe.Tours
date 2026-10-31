-- phase: expand
-- OpenVibe.Tours v1: a place database from OpenStreetMap, Wikivoyage and Wikidata; self-guided routes; live IRL
-- tours from OpenVibe.Live; stays from OpenVibe.Rent; and a person's trips. Nothing here is a credential. Source
-- rows are public open data with their source and fetch time; a trip is a person's own row (server/identity/account-data.js).

-- ── Cities ────────────────────────────────────────────────────
CREATE TABLE tours_cities (
    id               text COLLATE "C" PRIMARY KEY,              -- cty_ + 26 Crockford base32 chars (stable from the Wikidata id)
    slug             text COLLATE "C" NOT NULL UNIQUE,
    name             text NOT NULL,
    country          text NOT NULL,
    country_code     text COLLATE "C",
    region           text,
    lat              double precision NOT NULL,
    lon              double precision NOT NULL,
    population       bigint,
    wikidata_id      text COLLATE "C" NOT NULL UNIQUE,           -- Q…
    wikipedia_title  text,
    wikivoyage_title text,
    summary          text,
    image_url        text,
    image_credit     text,
    image_license    text,
    image_license_url text,
    source           text COLLATE "C" NOT NULL DEFAULT 'wikidata', -- wikidata | wikivoyage
    source_url       text NOT NULL,
    fetched_at       timestamptz NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tours_cities_id CHECK (id ~ '^cty_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT tours_cities_slug CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 90),
    CONSTRAINT tours_cities_name CHECK (length(name) BETWEEN 1 AND 120),
    CONSTRAINT tours_cities_country CHECK (length(country) BETWEEN 1 AND 120),
    CONSTRAINT tours_cities_country_code CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
    CONSTRAINT tours_cities_lat CHECK (lat BETWEEN -90 AND 90),
    CONSTRAINT tours_cities_lon CHECK (lon BETWEEN -180 AND 180),
    CONSTRAINT tours_cities_population CHECK (population IS NULL OR population >= 0),
    CONSTRAINT tours_cities_wikidata CHECK (wikidata_id ~ '^Q[1-9][0-9]{0,11}$'),
    CONSTRAINT tours_cities_source CHECK (source IN ('wikidata', 'wikivoyage')),
    CONSTRAINT tours_cities_source_url CHECK (source_url ~ '^https://')
);
CREATE INDEX tours_cities_population ON tours_cities (population DESC NULLS LAST);
CREATE INDEX tours_cities_country ON tours_cities (country);

-- The Wikivoyage wikitext a city's summary and See listings come from. Kept apart so the city row stays small.
CREATE TABLE tours_city_sources (
    city_id          text COLLATE "C" PRIMARY KEY REFERENCES tours_cities (id) ON DELETE CASCADE,
    wikivoyage_title text NOT NULL,
    wikitext         text NOT NULL,
    source_url       text NOT NULL,
    fetched_at       timestamptz NOT NULL,
    CONSTRAINT tours_city_sources_url CHECK (source_url ~ '^https://')
);

-- ── Places ───────────────────────────────────────────────────
CREATE TABLE tours_places (
    id             text COLLATE "C" PRIMARY KEY,                -- plc_ + stable from osm_type:osm_id
    city_id        text COLLATE "C" NOT NULL REFERENCES tours_cities (id) ON DELETE CASCADE,
    osm_type       text COLLATE "C" NOT NULL,                   -- node | way | relation
    osm_id         text COLLATE "C" NOT NULL,
    name           text NOT NULL,
    kind           text COLLATE "C" NOT NULL,                   -- the tourism=* value
    lat            double precision NOT NULL,
    lon            double precision NOT NULL,
    address        text,
    website        text,
    opening_hours  text,
    wheelchair     text COLLATE "C",                            -- yes | no | limited | null
    fee            text COLLATE "C",                            -- yes | no | null
    wikidata_id    text COLLATE "C",
    wikipedia      text,
    image_url      text,
    image_credit   text,
    image_license  text,
    description    text,
    source         text COLLATE "C" NOT NULL DEFAULT 'openstreetmap',
    source_url     text NOT NULL,
    fetched_at     timestamptz NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tours_places_id CHECK (id ~ '^plc_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT tours_places_osm_type CHECK (osm_type IN ('node', 'way', 'relation')),
    CONSTRAINT tours_places_osm_id CHECK (osm_id ~ '^[0-9]{1,20}$'),
    CONSTRAINT tours_places_name CHECK (length(name) BETWEEN 1 AND 200),
    CONSTRAINT tours_places_kind CHECK (kind ~ '^[a-z_]{2,40}$'),
    CONSTRAINT tours_places_lat CHECK (lat BETWEEN -90 AND 90),
    CONSTRAINT tours_places_lon CHECK (lon BETWEEN -180 AND 180),
    CONSTRAINT tours_places_wheelchair CHECK (wheelchair IS NULL OR wheelchair IN ('yes', 'no', 'limited')),
    CONSTRAINT tours_places_fee CHECK (fee IS NULL OR fee IN ('yes', 'no')),
    CONSTRAINT tours_places_source CHECK (source IN ('openstreetmap', 'wikivoyage', 'wikidata')),
    CONSTRAINT tours_places_source_url CHECK (source_url ~ '^https://'),
    UNIQUE (osm_type, osm_id)
);
CREATE INDEX tours_places_city ON tours_places (city_id, kind);
CREATE INDEX tours_places_wikidata ON tours_places (wikidata_id) WHERE wikidata_id IS NOT NULL;

-- ── Self-guided routes ───────────────────────────────────────
CREATE TABLE tours_routes (
    id          text COLLATE "C" PRIMARY KEY,                   -- rte_ + stable from city:wikipedia page:index
    city_id     text COLLATE "C" NOT NULL REFERENCES tours_cities (id) ON DELETE CASCADE,
    slug        text COLLATE "C" NOT NULL UNIQUE,
    title       text NOT NULL,
    summary     text,
    source      text COLLATE "C" NOT NULL DEFAULT 'wikivoyage',
    source_url  text NOT NULL,
    fetched_at  timestamptz NOT NULL,
    distance_m  integer NOT NULL DEFAULT 0,
    duration_min integer NOT NULL DEFAULT 0,
    stop_count  integer NOT NULL DEFAULT 0,
    generated   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tours_routes_id CHECK (id ~ '^rte_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT tours_routes_slug CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 110),
    CONSTRAINT tours_routes_title CHECK (length(title) BETWEEN 3 AND 160),
    CONSTRAINT tours_routes_source CHECK (source IN ('wikivoyage')),
    CONSTRAINT tours_routes_source_url CHECK (source_url ~ '^https://'),
    CONSTRAINT tours_routes_distance CHECK (distance_m >= 0),
    CONSTRAINT tours_routes_duration CHECK (duration_min >= 0),
    CONSTRAINT tours_routes_stop_count CHECK (stop_count BETWEEN 0 AND 30)
);
CREATE INDEX tours_routes_city ON tours_routes (city_id);

CREATE TABLE tours_route_stops (
    route_id     text COLLATE "C" NOT NULL REFERENCES tours_routes (id) ON DELETE CASCADE,
    position     integer NOT NULL,
    place_id     text COLLATE "C" REFERENCES tours_places (id) ON DELETE SET NULL,
    title        text NOT NULL,
    note         text,
    lat          double precision NOT NULL,
    lon          double precision NOT NULL,
    source       text COLLATE "C" NOT NULL DEFAULT 'wikivoyage',
    source_url   text NOT NULL,
    audio_status text COLLATE "C" NOT NULL DEFAULT 'none',       -- none | ready
    audio_url    text,
    PRIMARY KEY (route_id, position),
    CONSTRAINT tours_route_stops_position CHECK (position BETWEEN 1 AND 30),
    CONSTRAINT tours_route_stops_title CHECK (length(title) BETWEEN 1 AND 200),
    CONSTRAINT tours_route_stops_lat CHECK (lat BETWEEN -90 AND 90),
    CONSTRAINT tours_route_stops_lon CHECK (lon BETWEEN -180 AND 180),
    CONSTRAINT tours_route_stops_source CHECK (source IN ('wikivoyage')),
    CONSTRAINT tours_route_stops_source_url CHECK (source_url ~ '^https://'),
    CONSTRAINT tours_route_stops_audio CHECK (audio_status IN ('none', 'ready')),
    CONSTRAINT tours_route_stops_audio_url CHECK ((audio_status = 'none' AND audio_url IS NULL) OR (audio_status = 'ready' AND audio_url IS NOT NULL AND audio_url ~ '^https://'))
);

-- ── Live tours now (OpenVibe.Live's public stream list) ──────
CREATE TABLE tours_live (
    id            text COLLATE "C" PRIMARY KEY,                 -- liv_ + stable from kind:external_id
    kind          text COLLATE "C" NOT NULL,                    -- stream | vod
    external_id   text COLLATE "C" NOT NULL,
    username      text COLLATE "C" NOT NULL,
    display_name  text,
    title         text NOT NULL,
    category      text COLLATE "C",
    thumbnail_url text,
    viewer_count  integer NOT NULL DEFAULT 0,
    city_id       text COLLATE "C" REFERENCES tours_cities (id) ON DELETE SET NULL,
    city_name     text,
    url           text NOT NULL,
    started_at    timestamptz,
    ended_at      timestamptz,
    fetched_at    timestamptz NOT NULL,
    CONSTRAINT tours_live_id CHECK (id ~ '^liv_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT tours_live_kind CHECK (kind IN ('stream', 'vod')),
    CONSTRAINT tours_live_username CHECK (username ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$'),
    CONSTRAINT tours_live_title CHECK (length(title) BETWEEN 1 AND 240),
    CONSTRAINT tours_live_viewers CHECK (viewer_count >= 0),
    CONSTRAINT tours_live_url CHECK (url ~ '^https://'),
    UNIQUE (kind, external_id)
);
CREATE INDEX tours_live_kind ON tours_live (kind, fetched_at DESC);
CREATE INDEX tours_live_city ON tours_live (city_id) WHERE city_id IS NOT NULL;

-- ── Stays (OpenVibe.Rent's public listings) ──────────────────
CREATE TABLE tours_stays (
    id            text COLLATE "C" PRIMARY KEY,                 -- sty_ + stable from the Rent listing id
    external_id   text COLLATE "C" NOT NULL UNIQUE,             -- rnt_…
    city_id       text COLLATE "C" REFERENCES tours_cities (id) ON DELETE SET NULL,
    city_name     text NOT NULL,
    title         text NOT NULL,
    kind          text COLLATE "C" NOT NULL,
    price         numeric(12,2) NOT NULL,
    currency      text COLLATE "C" NOT NULL,
    period        text COLLATE "C" NOT NULL,
    neighbourhood text,
    url           text NOT NULL,
    fetched_at    timestamptz NOT NULL,
    CONSTRAINT tours_stays_id CHECK (id ~ '^sty_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT tours_stays_external CHECK (external_id ~ '^rnt_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT tours_stays_title CHECK (length(title) BETWEEN 1 AND 200),
    CONSTRAINT tours_stays_kind CHECK (kind IN ('apartment', 'room', 'house', 'commercial', 'parking', 'equipment', 'other')),
    CONSTRAINT tours_stays_price CHECK (price >= 0),
    CONSTRAINT tours_stays_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT tours_stays_period CHECK (period IN ('month', 'week', 'day', 'hour', 'once')),
    CONSTRAINT tours_stays_url CHECK (url ~ '^https://')
);
CREATE INDEX tours_stays_city ON tours_stays (city_id);

-- ── Trips (a signed-in person's own) ─────────────────────────
CREATE TABLE tours_trips (
    id            text COLLATE "C" PRIMARY KEY,                 -- trp_ + ULID
    slug          text COLLATE "C" NOT NULL UNIQUE,             -- the share link: a random 20-char suffix
    owner_subject text COLLATE "C" NOT NULL,                    -- usr_…; never a token
    title         text NOT NULL,
    city_id       text COLLATE "C" REFERENCES tours_cities (id) ON DELETE SET NULL,
    starts_on     date NOT NULL,
    ends_on       date NOT NULL,
    notes         text,
    visibility    text COLLATE "C" NOT NULL DEFAULT 'private',  -- private | shared
    revision      bigint NOT NULL DEFAULT 1,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tours_trips_id CHECK (id ~ '^trp_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT tours_trips_slug CHECK (slug ~ '^trip-[a-z0-9]{16,32}$'),
    CONSTRAINT tours_trips_owner CHECK (owner_subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT tours_trips_title CHECK (length(title) BETWEEN 3 AND 120),
    CONSTRAINT tours_trips_dates CHECK (ends_on >= starts_on AND ends_on - starts_on <= 60),
    CONSTRAINT tours_trips_notes CHECK (notes IS NULL OR length(notes) <= 2000),
    CONSTRAINT tours_trips_visibility CHECK (visibility IN ('private', 'shared')),
    CONSTRAINT tours_trips_revision CHECK (revision > 0)
);
CREATE INDEX tours_trips_owner ON tours_trips (owner_subject, starts_on DESC);
CREATE INDEX tours_trips_shared ON tours_trips (slug) WHERE visibility = 'shared';

CREATE TABLE tours_trip_places (
    trip_id    text COLLATE "C" NOT NULL REFERENCES tours_trips (id) ON DELETE CASCADE,
    place_id   text COLLATE "C" NOT NULL REFERENCES tours_places (id) ON DELETE CASCADE,
    position   integer NOT NULL DEFAULT 1,
    note       text,
    added_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, place_id),
    CONSTRAINT tours_trip_places_position CHECK (position BETWEEN 1 AND 200),
    CONSTRAINT tours_trip_places_note CHECK (note IS NULL OR length(note) <= 500)
);

CREATE TABLE tours_trip_routes (
    trip_id  text COLLATE "C" PRIMARY KEY REFERENCES tours_trips (id) ON DELETE CASCADE,
    route_id text COLLATE "C" NOT NULL REFERENCES tours_routes (id) ON DELETE CASCADE,
    added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tours_trip_stays (
    trip_id  text COLLATE "C" NOT NULL REFERENCES tours_trips (id) ON DELETE CASCADE,
    stay_id  text COLLATE "C" NOT NULL REFERENCES tours_stays (id) ON DELETE CASCADE,
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (trip_id, stay_id)
);

-- ── Job runs (the home says honestly what was fetched and when) ──
CREATE TABLE tours_job_runs (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job         text COLLATE "C" NOT NULL,
    started_at  timestamptz NOT NULL,
    finished_at timestamptz,
    status      text COLLATE "C" NOT NULL DEFAULT 'running',    -- running | ok | partial | failed
    counts      jsonb NOT NULL DEFAULT '{}'::jsonb,
    error       text,
    CONSTRAINT tours_job_runs_status CHECK (status IN ('running', 'ok', 'partial', 'failed'))
);
CREATE INDEX tours_job_runs_job ON tours_job_runs (job, started_at DESC);

-- ── The SDK's account receipts and request telemetry ────────
CREATE TABLE account_data_events (
    id         text PRIMARY KEY,
    kind       text NOT NULL,
    subject    text NOT NULL,
    outcome    jsonb,
    applied_at timestamptz NOT NULL DEFAULT now(),
    sent_at    timestamptz
);

CREATE TABLE telemetry_samples (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at                    timestamptz NOT NULL,
    service               text NOT NULL,
    project               text,
    subject               text,
    resource              text,
    provider              text,
    node                  text,
    cell                  text,
    region                text,
    operation             text NOT NULL,
    latency_ms            double precision,
    queue_delay_ms        double precision,
    ttfb_ms               double precision,
    throughput_per_second double precision,
    bytes                 bigint,
    status                text,
    cache_status          text,
    cost_estimate         double precision,
    route_epoch           bigint,
    trace_id              text,
    extra                 jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX telemetry_samples_at_idx ON telemetry_samples (at);
CREATE INDEX telemetry_samples_service_idx ON telemetry_samples (service, operation, at);
