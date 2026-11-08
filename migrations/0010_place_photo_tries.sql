-- phase: expand
-- When the places job last tried to find a photo for a place that has none, so a place with no free photo is not
-- asked about on every run (the photo pass retries after a week).
ALTER TABLE tours_places ADD COLUMN IF NOT EXISTS photo_tried_at timestamptz;
