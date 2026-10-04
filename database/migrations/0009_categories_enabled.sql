-- SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
-- SPDX-License-Identifier: Apache-2.0

-- Add an `enabled` flag to categories. SQLite has no native boolean, so it is
-- stored as INTEGER 0/1. Defaults to 0 (false) — a category is opt-in.

ALTER TABLE categories ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0;
