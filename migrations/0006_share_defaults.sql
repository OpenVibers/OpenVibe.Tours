-- phase: expand
-- Visibility step 3 (design 2026-11-06): the person's default audience for new trips, and one share row for every
-- trip that already exists. The old two words map 1:1: private -> Only me, shared -> Anyone with the link (a shared
-- trip was readable by whoever held its slug, and only its owner could edit it).
-- New trips are registered as they are made (server/sharing.js); a trip without a row is still its owner's, because
-- every read asks canView and a missing row falls back to the old column. Repeating this file is a no-op. Expand-only.

CREATE TABLE IF NOT EXISTS tours_share_defaults (
    subject    text COLLATE "C" PRIMARY KEY,
    audience   text COLLATE "C" NOT NULL CHECK (audience IN ('public', 'link', 'people', 'private')),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO shares (service, kind, resource_id, owner_subject, audience)
SELECT
    'tours', 'trip', t.slug,
    jsonb_build_object('type', 'user', 'id', t.owner_subject),
    CASE t.visibility WHEN 'shared' THEN 'link' ELSE 'private' END
FROM tours_trips t
ON CONFLICT (service, kind, resource_id) DO NOTHING;
