-- Add source_id (the numeric form value) to existing lookup tables.
-- Nullable so existing rows inserted by result scraping are unaffected.

ALTER TABLE specialties ADD COLUMN source_id TEXT;
ALTER TABLE clubs       ADD COLUMN source_id TEXT;

-- New standalone tables for categories and phases (previously only stored
-- as free-text inside the results table).

CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT    NOT NULL UNIQUE,
  name      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS phases (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT    NOT NULL UNIQUE,
  name      TEXT    NOT NULL
);
