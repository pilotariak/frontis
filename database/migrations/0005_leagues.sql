-- SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
-- SPDX-License-Identifier: Apache-2.0

-- Leagues table — one row per regional league, referenced by the scheduler
-- and subgraphs to scope competitions, clubs, and results.

CREATE TABLE IF NOT EXISTS leagues (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL UNIQUE,
  acronym   TEXT    NOT NULL UNIQUE,
  url       TEXT    NOT NULL
);
