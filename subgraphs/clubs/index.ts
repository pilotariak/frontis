import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { clubs as clubsData, specialties as specialtiesData } from "./data.js";
import type { Club, Specialty } from "./data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const typeDefs = parse(
  readFileSync(join(__dirname, "schema.graphql"), "utf-8")
);

const resolvers = {
  Query: {
    specialty(_: unknown, { id }: { id: string }): Specialty | undefined {
      return specialtiesData.find((s) => s.id === id);
    },
    specialties(): Specialty[] {
      return specialtiesData;
    },
    club(_: unknown, { id }: { id: string }): Club | undefined {
      return clubsData.find((c) => c.id === id);
    },
    clubs(_: unknown, { city }: { city?: string }): Club[] {
      if (city) {
        return clubsData.filter((c) => c.city === city);
      }
      return clubsData;
    },
  },

  // Entity resolvers — called by the gateway when resolving cross-subgraph reference resolution
  Specialty: {
    __resolveReference(ref: { id: string }): Specialty | undefined {
      return specialtiesData.find((s) => s.id === ref.id);
    },
  },
  Club: {
    __resolveReference(ref: { id: string }): Club | undefined {
      return clubsData.find((c) => c.id === ref.id);
    },
  },
};

const schema = buildSubgraphSchema({ typeDefs, resolvers });

const yoga = createYoga({ schema, graphqlEndpoint: "/graphql" });
const server = createServer(yoga);

const PORT = parseInt(process.env.PORT ?? "4001", 10);
server.listen(PORT, () => {
  console.log(`🏸 Clubs subgraph ready at http://localhost:${PORT}/graphql`);
});
