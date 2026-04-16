-- SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
-- SPDX-License-Identifier: Apache-2.0

-- Replace score_a / score_b integer columns with a single scores TEXT column
-- that stores the full multi-set score string (e.g. "15/10 15/13").
-- Pelota basque matches can have 2 or 3 sets, so two integers are insufficient.

ALTER TABLE results ADD COLUMN scores TEXT;

-- Migrate existing data: reconstruct score string from the two legacy integers.
UPDATE results
SET scores = CAST(score_a AS TEXT) || '/' || CAST(score_b AS TEXT)
WHERE score_a IS NOT NULL AND score_b IS NOT NULL;

ALTER TABLE results DROP COLUMN score_a;
ALTER TABLE results DROP COLUMN score_b;
