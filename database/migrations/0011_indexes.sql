-- SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
-- SPDX-License-Identifier: Apache-2.0

-- Secondary indexes for the query patterns served by the subgraphs and the
-- scheduler. Until now these existed only where they had been created by hand,
-- so a fresh database (new clone, new league) ran every filtered `results`
-- query as a full table scan. This migration makes the repository
-- the source of truth; `IF NOT EXISTS` keeps it a no-op on databases that
-- already carry them.
--
-- `results` has a UNIQUE(competition_id, …) constraint whose auto-index only
-- serves lookups that lead with competition_id. Every other filter exposed by
-- the results subgraph (specialtyId, categoryId, clubId, phase) and the
-- reverse edges Club.results / Specialty.results / Category.results needs its
-- own index. `clubId` matches either side of a match, so both club columns
-- are indexed and SQLite combines them (MULTI-INDEX OR).

CREATE INDEX IF NOT EXISTS idx_results_specialty_id ON results (specialty_id);
CREATE INDEX IF NOT EXISTS idx_results_category_id  ON results (category_id);
CREATE INDEX IF NOT EXISTS idx_results_club_a_id    ON results (club_a_id);
CREATE INDEX IF NOT EXISTS idx_results_club_b_id    ON results (club_b_id);
CREATE INDEX IF NOT EXISTS idx_results_phase        ON results (phase);
CREATE INDEX IF NOT EXISTS idx_results_date_match   ON results (date_match);

-- The scheduler resolves scraped dropdown values to rows by source_id for
-- these two tables; categories, phases and competitions already declare
-- source_id UNIQUE and therefore have an auto-index.
CREATE INDEX IF NOT EXISTS idx_specialties_source_id ON specialties (source_id);
CREATE INDEX IF NOT EXISTS idx_clubs_source_id       ON clubs (source_id);
