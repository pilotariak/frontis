import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import { createYoga } from "graphql-yoga";

const __dirname = dirname(fileURLToPath(import.meta.url));

const typeDefs = parse(
  readFileSync(join(__dirname, "schema.graphql"), "utf-8")
);

const { version } = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf-8")
);

const resolvers = {
  Query: {
    echo(_: unknown, { message }: { message: string }): string {
      return message;
    },
    version(): string {
      return version;
    },
  },
};

const schema = buildSubgraphSchema({ typeDefs, resolvers });

const yoga = createYoga({ schema, graphqlEndpoint: "/graphql" });
const server = createServer(yoga);

const PORT = parseInt(process.env.PORT ?? "4003", 10);
server.listen(PORT, () => {
  console.log(`🔁 Echo subgraph ready at http://localhost:${PORT}/graphql`);
});
