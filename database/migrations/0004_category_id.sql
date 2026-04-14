-- Replace the free-text `category` column in results with a `category_id`
-- foreign key referencing the new `categories` lookup table.
--
-- Steps:
--   1. Create the categories lookup table.
--   2. Seed it from distinct category strings already in results.
--   3. Recreate results with category_id (updating the UNIQUE constraint).
--   4. Populate category_id via a JOIN on the seeded categories.

PRAGMA foreign_keys = OFF;

-- 1. Create categories table (shared with the categories subgraph).
CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT UNIQUE,
  name      TEXT NOT NULL UNIQUE
);

-- 2. Seed categories from existing distinct values in results.
INSERT OR IGNORE INTO categories (name)
  SELECT DISTINCT category FROM results WHERE category IS NOT NULL;

-- 3. Recreate results with category_id instead of category text.
CREATE TABLE results_new (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id        INTEGER NOT NULL REFERENCES competitions(id),
  specialty_id          INTEGER NOT NULL REFERENCES specialties(id),
  category_id           INTEGER NOT NULL REFERENCES categories(id),
  club_a_id             INTEGER NOT NULL REFERENCES clubs(id),
  club_b_id             INTEGER NOT NULL REFERENCES clubs(id),
  date_match            TEXT,
  score_a               INTEGER,
  score_b               INTEGER,
  phase                 TEXT,
  club_a_player1_name   TEXT,
  club_a_player1_number TEXT,
  club_a_player2_name   TEXT,
  club_a_player2_number TEXT,
  club_b_player1_name   TEXT,
  club_b_player1_number TEXT,
  club_b_player2_name   TEXT,
  club_b_player2_number TEXT,
  UNIQUE(competition_id, specialty_id, category_id, date_match, club_a_id, club_b_id, phase)
);

-- 4. Copy data, resolving category text → category_id via the lookup table.
INSERT INTO results_new (
  id, competition_id, specialty_id, category_id,
  club_a_id, club_b_id, date_match, score_a, score_b, phase,
  club_a_player1_name, club_a_player1_number,
  club_a_player2_name, club_a_player2_number,
  club_b_player1_name, club_b_player1_number,
  club_b_player2_name, club_b_player2_number
)
SELECT
  r.id, r.competition_id, r.specialty_id,
  c.id AS category_id,
  r.club_a_id, r.club_b_id, r.date_match, r.score_a, r.score_b, r.phase,
  r.club_a_player1_name, r.club_a_player1_number,
  r.club_a_player2_name, r.club_a_player2_number,
  r.club_b_player1_name, r.club_b_player1_number,
  r.club_b_player2_name, r.club_b_player2_number
FROM results r
LEFT JOIN categories c ON c.name = r.category;

DROP TABLE results;
ALTER TABLE results_new RENAME TO results;

PRAGMA foreign_keys = ON;
