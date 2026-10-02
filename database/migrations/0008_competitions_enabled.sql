-- SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
-- SPDX-License-Identifier: Apache-2.0

-- Add an `enabled` flag to competitions. SQLite has no native boolean, so it is
-- stored as INTEGER 0/1. Defaults to 0 (false) — a competition is opt-in.

ALTER TABLE competitions ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0;
