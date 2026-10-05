// SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
// SPDX-License-Identifier: Apache-2.0

export interface Env {
  DB_LEAGUE_LCAPB: D1Database;
  DB_LEAGUE_LIDFPB: D1Database;
  DB_LEAGUE_CTPB: D1Database;
  /** Shared secret expected in the `x-internal-token` header of every HTTP
   *  request (except `/version`). Same value as the gateway and subgraphs;
   *  set with `wrangler secret put` or in `.dev.vars` locally. */
  INTERNAL_SERVICE_TOKEN: string;
}

export interface League {
  id: number;
  name: string;
  acronym: string;
  url: string;
}

export interface FormOption {
  sourceId: string;
  name: string;
}

export interface FormOptions {
  competitions: FormOption[];
  specialties: FormOption[];
  categories: FormOption[];
}
