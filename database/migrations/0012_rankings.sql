-- SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
-- SPDX-License-Identifier: Apache-2.0

-- End-of-championship rankings ("Classement à la fin du championnat"), scraped
-- from the league sites' classements.php by the scheduler's /scrape_rankings.
--
-- One `rankings` row per team of a (competition, specialty, category) ranking.
-- A ranking changes while its championship runs, so the scheduler replaces a
-- whole (competition, specialty, category) ranking in one batch instead of
-- inserting rows one by one.
--
-- Players live in `ranking_players`, one row per player in the site's order:
-- a team lists two or three players, and players are looked up by licence or
-- by name. `licence` is TEXT because leading zeros matter ("000101").
-- `name_key` is the name upper-cased with accents and punctuation stripped,
-- since SQLite has no accent-insensitive collation. `licence_club` (the
-- player's licence club code, e.g. "01-330-005") and `marker` ("E", "S",
-- "ES") are kept as printed by the site and are not exposed by the gateway
-- until their meaning is confirmed.

CREATE TABLE IF NOT EXISTS rankings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  specialty_id   INTEGER NOT NULL REFERENCES specialties(id),
  category_id    INTEGER NOT NULL REFERENCES categories(id),
  club_id        INTEGER NOT NULL REFERENCES clubs(id),
  team_number    INTEGER NOT NULL,
  rank           INTEGER NOT NULL,
  phase          TEXT    NOT NULL,
  UNIQUE (competition_id, specialty_id, category_id, club_id, team_number)
);

CREATE TABLE IF NOT EXISTS ranking_players (
  ranking_id   INTEGER NOT NULL REFERENCES rankings(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  licence      TEXT    NOT NULL,
  name         TEXT,
  name_key     TEXT,
  licence_club TEXT,
  marker       TEXT,
  PRIMARY KEY (ranking_id, position)
);

CREATE INDEX IF NOT EXISTS idx_ranking_players_licence ON ranking_players (licence);
