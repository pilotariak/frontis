-- Initial schema — mirrors the tables written by the bildu scheduler.

CREATE TABLE IF NOT EXISTS specialties (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS clubs (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS competitions (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  year  INTEGER NOT NULL,
  name  TEXT NOT NULL,
  level TEXT,
  UNIQUE(year, name, level)
);

CREATE TABLE IF NOT EXISTS results (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id        INTEGER NOT NULL REFERENCES competitions(id),
  specialty_id          INTEGER NOT NULL REFERENCES specialties(id),
  club_a_id             INTEGER NOT NULL REFERENCES clubs(id),
  club_b_id             INTEGER NOT NULL REFERENCES clubs(id),
  category              TEXT,
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
  UNIQUE(competition_id, specialty_id, category, date_match, club_a_id, club_b_id, phase)
);
