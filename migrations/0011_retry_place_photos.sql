-- phase: migrate
-- On 11-08 Media answered 429 to most photo copies and the photo pass marked those places tried for a week. Clear the
-- mark on every place still without a photo, so the next runs (now paced under Media's limit) try them again.
UPDATE tours_places SET photo_tried_at = NULL WHERE image_url IS NULL AND photo_tried_at IS NOT NULL;
