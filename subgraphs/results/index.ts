import { buildSubgraphSchema } from "@apollo/subgraph";
import { useOpenTelemetry } from "@envelop/opentelemetry";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase } from "./db.js";
import type { Context, Env, ResultRow } from "./db.js";
import { createGroupLoader, createRowLoader } from "./loader.js";
import {
  breakdown,
  filterMatches,
  lineupPlayer,
  matchups,
  nameKey,
  tally,
  toMatches,
} from "./players.js";
import type { Match, MatchFilters, Matchup, ParticipationRow, StatsLine } from "./players.js";
import { parseSets, winnerSide } from "./scores.js";
import schema from "./schema.graphql" with { type: "text" };
import { useSubgraphMetrics, withHttpMetrics } from "./metrics.js";
import { setupTracing } from "./tracing.js";

setupTracing("frontis-results");

const typeDefs = parse(schema);

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

interface PageArgs {
  limit?: number | null;
  offset?: number | null;
}

interface PlayerFilters {
  competitionId?: string | null;
  specialtyId?: string | null;
  categoryId?: string | null;
}

interface ResultFilters extends PageArgs, PlayerFilters {
  clubId?: string | null;
  phase?: string | null;
  /** Only the results this licence played in. */
  licence?: string;
}

/** A `Player` as resolvers pass it around: the licence, and the name once known. */
interface PlayerRef {
  licence: string;
  name: string | null;
}

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

/** Parse a GraphQL ID into an integer primary key, rejecting garbage early. */
function toId(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw badInput(`Invalid ${name}: ${value}`);
  return n;
}

function page({ limit, offset }: PageArgs): { limit: number; offset: number } {
  const l = limit ?? DEFAULT_LIMIT;
  const o = offset ?? 0;
  return {
    limit: Math.min(Math.max(l, 1), MAX_LIMIT),
    offset: Math.max(o, 0),
  };
}

const BY_ID = "id";
/** `date_match` is DD/MM/YYYY: compare it as YYYYMMDD. */
const MOST_RECENT_FIRST =
  "substr(date_match, 7, 4) || substr(date_match, 4, 2) || substr(date_match, 1, 2) DESC, id DESC";

async function queryResults(
  db: D1Database,
  filters: ResultFilters,
  orderBy: string = BY_ID
): Promise<ResultRow[]> {
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (filters.licence !== undefined) {
    conditions.push("id IN (SELECT result_id FROM result_players WHERE licence = ?)");
    bindings.push(filters.licence);
  }
  if (filters.competitionId) {
    conditions.push("competition_id = ?");
    bindings.push(toId(filters.competitionId, "competitionId"));
  }
  if (filters.specialtyId) {
    conditions.push("specialty_id = ?");
    bindings.push(toId(filters.specialtyId, "specialtyId"));
  }
  if (filters.categoryId) {
    conditions.push("category_id = ?");
    bindings.push(toId(filters.categoryId, "categoryId"));
  }
  if (filters.clubId) {
    const id = toId(filters.clubId, "clubId");
    conditions.push("(club_a_id = ? OR club_b_id = ?)");
    bindings.push(id, id);
  }
  if (filters.phase) {
    conditions.push("phase = ?");
    bindings.push(filters.phase);
  }

  const { limit, offset } = page(filters);
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM results${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);

  const { results } = await db.prepare(sql).bind(...bindings).all<ResultRow>();
  return results;
}

function winnerRef(row: ResultRow): { __typename: "Club"; id: string } | null {
  const side = winnerSide(row.scores);
  if (side === null) return null;
  return { __typename: "Club", id: String(side === "A" ? row.club_a_id : row.club_b_id) };
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/**
 * A player known to the league: in a result, or failing that in a ranking
 * (both tables live in the league's D1). The name is that of the latest result,
 * else of the latest ranking.
 */
const PLAYER_SQL = `SELECT ?1 AS licence, coalesce(
    (SELECT name FROM result_players WHERE licence = ?1 AND name IS NOT NULL ORDER BY result_id DESC LIMIT 1),
    (SELECT name FROM ranking_players WHERE licence = ?1 AND name IS NOT NULL ORDER BY ranking_id DESC LIMIT 1)
  ) AS name
  WHERE EXISTS (SELECT 1 FROM result_players WHERE licence = ?1)
     OR EXISTS (SELECT 1 FROM ranking_players WHERE licence = ?1)`;

async function findPlayer(db: D1Database, licence: string): Promise<PlayerRef | null> {
  const trimmed = licence.trim();
  if (!trimmed) throw badInput("licence must not be empty");
  return db.prepare(PLAYER_SQL).bind(trimmed).first<PlayerRef>();
}

async function searchPlayers(db: D1Database, name: string, args: PageArgs): Promise<PlayerRef[]> {
  // Name words are [A-Z0-9]+ after normalisation, so they need no LIKE escaping.
  const words = nameKey(name).split(" ").filter((w) => w.length >= 2);
  if (words.length === 0) throw badInput("name must contain a word of two characters or more");
  const { limit, offset } = page(args);
  // `name` is a bare column next to max(): SQLite takes it from the latest result.
  const sql = `SELECT licence, name, max(result_id) AS latest FROM result_players
    WHERE ${words.map(() => "name_key LIKE ?").join(" AND ")}
    GROUP BY licence
    ORDER BY name, licence
    LIMIT ? OFFSET ?`;
  const { results } = await db
    .prepare(sql)
    .bind(...words.map((w) => `%${w}%`), limit, offset)
    .all<PlayerRef & { latest: number }>();
  return results.map(({ licence, name }) => ({ licence, name }));
}

/**
 * Every match of the players loaded, with the other players of each match.
 * Callers append `WHERE me.licence IN (...)`.
 */
const PARTICIPATION_SELECT = `SELECT me.licence, me.side, r.id AS result_id, r.competition_id, r.specialty_id,
    r.category_id, r.scores, c.source_id AS season,
    o.licence AS other_licence, o.name AS other_name, o.side AS other_side
  FROM result_players me
  JOIN results r ON r.id = me.result_id
  JOIN competitions c ON c.id = r.competition_id
  LEFT JOIN result_players o ON o.result_id = me.result_id AND o.licence <> me.licence`;

function matchFilters(args: PlayerFilters): MatchFilters {
  return {
    competitionId: args.competitionId ? toId(args.competitionId, "competitionId") : undefined,
    specialtyId: args.specialtyId ? toId(args.specialtyId, "specialtyId") : undefined,
    categoryId: args.categoryId ? toId(args.categoryId, "categoryId") : undefined,
  };
}

async function playerMatches(player: PlayerRef, args: PlayerFilters, ctx: Context): Promise<Match[]> {
  const filters = matchFilters(args);
  return filterMatches(toMatches(await ctx.participations.load(player.licence)), filters);
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

const resolvers = {
  Query: {
    async result(
      _: unknown,
      { id }: { id: string },
      { db }: Context
    ): Promise<ResultRow | null> {
      return db
        .prepare("SELECT * FROM results WHERE id = ?")
        .bind(toId(id, "id"))
        .first<ResultRow>();
    },

    results(_: unknown, args: ResultFilters, { db }: Context): Promise<ResultRow[]> {
      return queryResults(db, args);
    },

    player(_: unknown, { licence }: { licence: string }, { db }: Context): Promise<PlayerRef | null> {
      return findPlayer(db, licence);
    },

    players(_: unknown, { name, ...args }: { name: string } & PageArgs, { db }: Context): Promise<PlayerRef[]> {
      return searchPlayers(db, name, args);
    },
  },

  Result: {
    // Batched: every representation in one `_entities` query is resolved by
    // a single `WHERE id IN (...)` statement (see loader.ts).
    // `async` so an invalid id rejects this entity only, instead of throwing
    // synchronously out of the whole `_entities` list.
    async __resolveReference(
      ref: { id: string },
      { results }: Context
    ): Promise<ResultRow | null> {
      return results.load(toId(ref.id, "id"));
    },

    // snake_case DB columns → camelCase GraphQL fields
    dateMatch: (row: ResultRow) => row.date_match,

    competition: (row: ResultRow) => ({ __typename: "Competition", id: String(row.competition_id) }),
    specialty: (row: ResultRow) => ({ __typename: "Specialty", id: String(row.specialty_id) }),
    category: (row: ResultRow) =>
      row.category_id != null ? { __typename: "Category", id: String(row.category_id) } : null,
    clubA: (row: ResultRow) => ({ __typename: "Club", id: String(row.club_a_id) }),
    clubB: (row: ResultRow) => ({ __typename: "Club", id: String(row.club_b_id) }),

    sets: (row: ResultRow) => parseSets(row.scores),
    winner: (row: ResultRow) => winnerRef(row),

    clubALineup(row: ResultRow) {
      return {
        player1: row.club_a_player1_name
          ? { name: row.club_a_player1_name, number: row.club_a_player1_number }
          : null,
        player2: row.club_a_player2_name
          ? { name: row.club_a_player2_name, number: row.club_a_player2_number }
          : null,
      };
    },

    clubBLineup(row: ResultRow) {
      return {
        player1: row.club_b_player1_name
          ? { name: row.club_b_player1_name, number: row.club_b_player1_number }
          : null,
        player2: row.club_b_player2_name
          ? { name: row.club_b_player2_name, number: row.club_b_player2_number }
          : null,
      };
    },
  },

  LineupPlayer: {
    player: (p: { name: string; number: string | null }): PlayerRef | null => lineupPlayer(p.name, p.number),
  },

  Player: {
    // Only reached if another subgraph returns a Player: every Player of this
    // subgraph's own fields already carries its name.
    async __resolveReference(ref: { licence: string }, { db }: Context): Promise<PlayerRef | null> {
      return findPlayer(db, ref.licence);
    },

    async stats(player: PlayerRef, args: PlayerFilters, ctx: Context) {
      const matches = await playerMatches(player, args, ctx);
      return { ...tally(matches), breakdown: breakdown(matches) };
    },

    async partners(player: PlayerRef, args: PlayerFilters, ctx: Context): Promise<Matchup[]> {
      return matchups(await playerMatches(player, args, ctx), "partners");
    },

    async opponents(player: PlayerRef, args: PlayerFilters, ctx: Context): Promise<Matchup[]> {
      return matchups(await playerMatches(player, args, ctx), "opponents");
    },

    results(player: PlayerRef, args: ResultFilters, { db }: Context): Promise<ResultRow[]> {
      return queryResults(db, { ...args, licence: player.licence }, MOST_RECENT_FIRST);
    },
  },

  PlayerStatsLine: {
    competition: (line: StatsLine) => ({ __typename: "Competition", id: String(line.competitionId) }),
    specialty: (line: StatsLine) => ({ __typename: "Specialty", id: String(line.specialtyId) }),
    category: (line: StatsLine) =>
      line.categoryId != null ? { __typename: "Category", id: String(line.categoryId) } : null,
  },

  PlayerMatchup: {
    player: (m: Matchup): PlayerRef => ({ licence: m.licence, name: m.name }),
  },

  // Reverse edges contributed to entities owned by other subgraphs. The
  // gateway hands us `{ id }` representations; no __resolveReference is
  // needed because @apollo/subgraph returns the representation as-is.
  Club: {
    results(ref: { id: string }, args: PageArgs, { db }: Context): Promise<ResultRow[]> {
      return queryResults(db, { ...args, clubId: ref.id });
    },
  },

  Specialty: {
    results(ref: { id: string }, args: PageArgs, { db }: Context): Promise<ResultRow[]> {
      return queryResults(db, { ...args, specialtyId: ref.id });
    },
  },

  Category: {
    results(ref: { id: string }, args: PageArgs, { db }: Context): Promise<ResultRow[]> {
      return queryResults(db, { ...args, categoryId: ref.id });
    },
  },
};

const schema_ = buildSubgraphSchema([{ typeDefs, resolvers }]);

const yoga = createYoga<{ env: Env } & ExecutionContext>({
  schema: schema_,
  graphqlEndpoint: "/graphql",
  plugins: [useOpenTelemetry({}), useSubgraphMetrics("frontis-results")],
  context: ({ request, env }) => {
    const league = request.headers.get("x-pilotariak-league");
    if (!league) {
      throw new GraphQLError("Missing X-Pilotariak-League header", {
        extensions: { code: "BAD_REQUEST" },
      });
    }
    const db = getDatabase(env, league);
    return {
      db,
      results: createRowLoader<ResultRow>(db, "SELECT * FROM results"),
      participations: createGroupLoader<ParticipationRow, string>(async (licences) => {
        const placeholders = licences.map(() => "?").join(", ");
        const { results } = await db
          .prepare(`${PARTICIPATION_SELECT} WHERE me.licence IN (${placeholders}) ORDER BY r.id`)
          .bind(...licences)
          .all<ParticipationRow>();
        return results;
      }, (row) => row.licence),
    };
  },
});

const yogaFetch = withHttpMetrics((request: Request, env: Env, ctx: ExecutionContext) =>
  yoga.fetch(request, { env }, ctx)
);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.headers.get("x-internal-token") !== env.INTERNAL_SERVICE_TOKEN) {
      return new Response("Forbidden", { status: 403 });
    }
    return yogaFetch(request, env, ctx);
  },
};
