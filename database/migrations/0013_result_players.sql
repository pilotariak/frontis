-- SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
-- SPDX-License-Identifier: Apache-2.0

-- Players of the match results, one row per player, so results can be queried
-- by player (statistics, partners, opponents).
--
-- `results` keeps its four `club_{a,b}_player{1,2}_{name,number}` column
-- pairs; this table is derived from them, by this migration for existing rows
-- and by the scheduler's saveResults for new ones. The two must normalise the
-- same way (see resultPlayers in workers/scheduler/src/players.ts):
--   - `number` is "059063" or "097866 - 01-641-015": the licence, then
--     optionally the licence club after the first dash.
--   - `name` is "PRADERE Bastien (S)": runs of spaces are collapsed and a
--     trailing upper-case marker of one to three letters is moved to `marker`.
--   - `name_key` is the same key as `ranking_players.name_key`: upper case, no
--     accents, punctuation turned into spaces.
-- A player without a number has no licence and gets no row.
-- `side` is 'A' or 'B' (club A or club B), `position` 1 or 2.

CREATE TABLE IF NOT EXISTS result_players (
  result_id    INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  side         TEXT    NOT NULL CHECK (side IN ('A', 'B')),
  position     INTEGER NOT NULL,
  licence      TEXT    NOT NULL,
  licence_club TEXT,
  name         TEXT,
  name_key     TEXT,
  marker       TEXT,
  PRIMARY KEY (result_id, side, position)
);

CREATE INDEX IF NOT EXISTS idx_result_players_licence ON result_players (licence);

-- Backfill. `name_key` starts as upper(name): SQLite upper-cases ASCII only,
-- so the UPDATEs below fold the accents and the punctuation.
INSERT OR IGNORE INTO result_players (result_id, side, position, licence, licence_club, name, name_key, marker)
WITH raw (result_id, side, position, name, number) AS (
  SELECT id, 'A', 1, club_a_player1_name, club_a_player1_number FROM results
  UNION ALL SELECT id, 'A', 2, club_a_player2_name, club_a_player2_number FROM results
  UNION ALL SELECT id, 'B', 1, club_b_player1_name, club_b_player1_number FROM results
  UNION ALL SELECT id, 'B', 2, club_b_player2_name, club_b_player2_number FROM results
),
cleaned AS (
  SELECT result_id, side, position,
    trim(replace(replace(replace(name, '  ', ' '), '  ', ' '), '  ', ' ')) AS name,
    trim(number) AS number
  FROM raw
),
split AS (
  SELECT result_id, side, position, name,
    CASE WHEN instr(number, '-') > 0 THEN trim(substr(number, 1, instr(number, '-') - 1)) ELSE number END AS licence,
    CASE WHEN instr(number, '-') > 0 THEN nullif(trim(substr(number, instr(number, '-') + 1)), '') END AS licence_club,
    CASE
      WHEN name GLOB '*([A-Z])' THEN substr(name, -2, 1)
      WHEN name GLOB '*([A-Z][A-Z])' THEN substr(name, -3, 2)
      WHEN name GLOB '*([A-Z][A-Z][A-Z])' THEN substr(name, -4, 3)
    END AS marker
  FROM cleaned
),
named AS (
  SELECT result_id, side, position, licence, licence_club, marker,
    nullif(rtrim(CASE WHEN marker IS NULL THEN name ELSE substr(name, 1, length(name) - length(marker) - 2) END), '') AS name
  FROM split
)
SELECT result_id, side, position, licence, licence_club, name, upper(name), marker
FROM named
WHERE licence IS NOT NULL AND licence <> '';

UPDATE result_players SET name_key =
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(name_key,
    'à', 'A'), 'á', 'A'), 'â', 'A'), 'ã', 'A'), 'ä', 'A'), 'å', 'A'),
    'À', 'A'), 'Á', 'A'), 'Â', 'A'), 'Ã', 'A'), 'Ä', 'A'), 'Å', 'A')
WHERE name_key GLOB '*[àáâãäåÀÁÂÃÄÅ]*';

UPDATE result_players SET name_key = replace(replace(name_key, 'ç', 'C'), 'Ç', 'C')
WHERE name_key GLOB '*[çÇ]*';

UPDATE result_players SET name_key =
  replace(replace(replace(replace(replace(replace(replace(replace(name_key,
    'è', 'E'), 'é', 'E'), 'ê', 'E'), 'ë', 'E'),
    'È', 'E'), 'É', 'E'), 'Ê', 'E'), 'Ë', 'E')
WHERE name_key GLOB '*[èéêëÈÉÊË]*';

UPDATE result_players SET name_key =
  replace(replace(replace(replace(replace(replace(replace(replace(name_key,
    'ì', 'I'), 'í', 'I'), 'î', 'I'), 'ï', 'I'),
    'Ì', 'I'), 'Í', 'I'), 'Î', 'I'), 'Ï', 'I')
WHERE name_key GLOB '*[ìíîïÌÍÎÏ]*';

UPDATE result_players SET name_key = replace(replace(name_key, 'ñ', 'N'), 'Ñ', 'N')
WHERE name_key GLOB '*[ñÑ]*';

UPDATE result_players SET name_key =
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(name_key,
    'ò', 'O'), 'ó', 'O'), 'ô', 'O'), 'õ', 'O'), 'ö', 'O'),
    'Ò', 'O'), 'Ó', 'O'), 'Ô', 'O'), 'Õ', 'O'), 'Ö', 'O')
WHERE name_key GLOB '*[òóôõöÒÓÔÕÖ]*';

UPDATE result_players SET name_key =
  replace(replace(replace(replace(replace(replace(replace(replace(name_key,
    'ù', 'U'), 'ú', 'U'), 'û', 'U'), 'ü', 'U'),
    'Ù', 'U'), 'Ú', 'U'), 'Û', 'U'), 'Ü', 'U')
WHERE name_key GLOB '*[ùúûüÙÚÛÜ]*';

UPDATE result_players SET name_key = replace(replace(replace(replace(name_key, 'ý', 'Y'), 'ÿ', 'Y'), 'Ý', 'Y'), 'Ÿ', 'Y')
WHERE name_key GLOB '*[ýÿÝŸ]*';

-- Punctuation to spaces, then collapse the runs of spaces this leaves.
UPDATE result_players SET name_key =
  nullif(trim(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(replace(replace(name_key,
      '''', ' '), '’', ' '), '-', ' '), '.', ' '), ',', ' '), '(', ' '), ')', ' '), '/', ' '),
    '  ', ' '), '  ', ' '), '  ', ' ')), '')
WHERE name_key GLOB '*[^A-Z0-9 ]*' OR instr(name_key, '  ') > 0;
