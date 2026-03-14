import { buildSubgraphSchema } from "@apollo/subgraph";
import { useOpenTelemetry } from "@envelop/opentelemetry";
import { parse } from "graphql";
import { createYoga } from "graphql-yoga";
import pkg from "../../package.json";
import schema from "./schema.graphql" with { type: "text" };
import { useSubgraphMetrics, withHttpMetrics } from "./metrics.js";
import { setupTracing } from "./tracing.js";

setupTracing("frontis-echo");

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
  plugins: [useOpenTelemetry({}), useSubgraphMetrics("frontis-echo")],
});

export default { fetch: withHttpMetrics(yoga.fetch.bind(yoga)) };
