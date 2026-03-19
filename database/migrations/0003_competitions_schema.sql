-- Remove year and level from competitions; add source_id.
-- SQLite cannot drop columns that belong to a UNIQUE constraint, so the table
-- is recreated. Foreign key references from results are preserved via id.

PRAGMA foreign_keys = OFF;

CREATE TABLE competitions_new (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT UNIQUE,
  name      TEXT NOT NULL UNIQUE
);

INSERT INTO competitions_new (id, name)
  SELECT id, name FROM competitions;

DROP TABLE competitions;

ALTER TABLE competitions_new RENAME TO competitions;

PRAGMA foreign_keys = ON;
