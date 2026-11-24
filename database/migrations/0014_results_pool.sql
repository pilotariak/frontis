-- SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
-- SPDX-License-Identifier: Apache-2.0

-- The pool of each match, as the league site's results page (resultats.php)
-- prints it. `phase` ("P 10") numbers a match within the pool round, it is not
-- a pool number: the pool is the section title above the match.
--
-- `pool` is the N of a "Poules N" section title, NULL for any other section
-- ("1/4 de finale", "Barrage 1er tour", …). `pool_phase` is the N of the block
-- heading "GROUPE A Poule phase N", NULL when the page names a single pool
-- phase for that specialty and category. Both stay NULL on rows stored before
-- this migration until the scheduler scrapes them again: its upsert fills them.
--
-- The UNIQUE key of `results` is unchanged.

ALTER TABLE results ADD COLUMN pool INTEGER;
ALTER TABLE results ADD COLUMN pool_phase INTEGER;
