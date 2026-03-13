import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { clubs as clubsData, specialties as specialtiesData } from "./data.js";
import type { Club, Specialty } from "./data.js";
import schema from "./schema.graphql";

const typeDefs = parse(schema);

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

const yoga = createYoga({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
  graphqlEndpoint: "/graphql",
});

export default { fetch: yoga };
