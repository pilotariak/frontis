import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import { createYoga } from "graphql-yoga";
import {
  competitions as competitionsData,
  results as resultsData,
} from "./data.js";
import type { Competition, Result } from "./data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const typeDefs = parse(
  readFileSync(join(__dirname, "schema.graphql"), "utf-8")
);

const resolvers = {
  Query: {
    competition(_: unknown, { id }: { id: string }): Competition | undefined {
      return competitionsData.find((c) => c.id === id);
    },
    competitions(_: unknown, { year }: { year?: number }): Competition[] {
      if (year !== undefined) {
        return competitionsData.filter((c) => c.year === year);
      }
      return competitionsData;
    },
    result(_: unknown, { id }: { id: string }): Result | undefined {
      return resultsData.find((r) => r.id === id);
    },
    results(
      _: unknown,
      {
        competitionId,
        specialtyId,
        category,
        phase,
      }: {
        competitionId?: string;
        specialtyId?: string;
        category?: string;
        phase?: string;
      }
    ): Result[] {
      return resultsData.filter((r) => {
        if (competitionId && r.competitionId !== competitionId) return false;
        if (specialtyId && r.specialtyId !== specialtyId) return false;
        if (category && r.category !== category) return false;
        if (phase && r.phase !== phase) return false;
        return true;
      });
    },
  },

  Competition: {
    __resolveReference(ref: { id: string }): Competition | undefined {
      return competitionsData.find((c) => c.id === ref.id);
    },
    results(competition: Competition): Result[] {
      return resultsData.filter((r) => r.competitionId === competition.id);
    },
  },

  Result: {
    __resolveReference(ref: { id: string }): Result | undefined {
      return resultsData.find((r) => r.id === ref.id);
    },
    // Return entity references — the gateway resolves full Club/Specialty via the clubs subgraph
    competition(result: Result) {
      return { __typename: "Competition", id: result.competitionId };
    },
    specialty(result: Result) {
      return { __typename: "Specialty", id: result.specialtyId };
    },
    clubA(result: Result) {
      return { __typename: "Club", id: result.clubAId };
    },
    clubB(result: Result) {
      return { __typename: "Club", id: result.clubBId };
    },
    clubALineup(result: Result) {
      return result.clubALineup;
    },
    clubBLineup(result: Result) {
      return result.clubBLineup;
    },
  },
};

const schema = buildSubgraphSchema({ typeDefs, resolvers });

const yoga = createYoga({ schema, graphqlEndpoint: "/graphql" });
const server = createServer(yoga);

const PORT = parseInt(process.env.PORT ?? "4002", 10);
server.listen(PORT, () => {
  console.log(
    `🏆 Competitions subgraph ready at http://localhost:${PORT}/graphql`
  );
});
