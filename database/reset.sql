-- SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
-- SPDX-License-Identifier: Apache-2.0

-- Reset all scraped data. Deletes in dependency order (results and rankings
-- first, then lookup tables) so foreign key constraints are satisfied.
-- leagues is preserved — it is seed data, not scraped data.

PRAGMA foreign_keys = OFF;

DELETE FROM result_players;
DELETE FROM results;
DELETE FROM ranking_players;
DELETE FROM rankings;
DELETE FROM competitions;
DELETE FROM specialties;
DELETE FROM categories;
DELETE FROM clubs;
DELETE FROM phases;

PRAGMA foreign_keys = ON;
