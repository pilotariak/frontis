-- SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
-- SPDX-License-Identifier: Apache-2.0

-- Clean up phase values that were stored as "GROUPE A Poule phase 1 - P 8".
-- Keep only the part after the last " - " separator (e.g. "P 8").

UPDATE results
SET phase = TRIM(SUBSTR(phase, INSTR(phase, ' - ') + 3))
WHERE INSTR(phase, ' - ') > 0;
