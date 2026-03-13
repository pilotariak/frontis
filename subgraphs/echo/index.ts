import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import { createYoga } from "graphql-yoga";
import pkg from "../../package.json";
import schema from "./schema.graphql";

const typeDefs = parse(schema);

const resolvers = {
  Query: {
    echo(_: unknown, { message }: { message: string }): string {
      return message;
    },
    version(): string {
      return pkg.version;
    },
  },
};

const yoga = createYoga({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
  graphqlEndpoint: "/graphql",
});

export default { fetch: yoga };
