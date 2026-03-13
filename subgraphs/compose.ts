/**
 * Composes the supergraph SDL from all subgraph schemas using
 * @theguild/federation-composition (no Rover CLI required).
 *
 * Generates two output files:
 *   - ../gateway/supergraph.graphql          (localhost URLs — local dev)
 *   - ../gateway/supergraph.docker.graphql   (Docker network hostnames)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "graphql";
import { composeServices } from "@theguild/federation-composition";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSchema(subgraph: string) {
  const sdl = readFileSync(join(__dirname, subgraph, "schema.graphql"), "utf-8");
  return parse(sdl);
}

const subgraphs = [
  {
    name: "echo",
    url: "http://localhost:4003/graphql",
    dockerUrl: "http://echo_subgraph:4003/graphql",
    typeDefs: readSchema("echo"),
  },
  {
    name: "clubs",
    url: "http://localhost:4001/graphql",
    dockerUrl: "http://clubs_subgraph:4001/graphql",
    typeDefs: readSchema("clubs"),
  },
  {
    name: "competitions",
    url: "http://localhost:4002/graphql",
    dockerUrl: "http://competitions_subgraph:4002/graphql",
    typeDefs: readSchema("competitions"),
  },
];

function compose(useDockerUrls: boolean): string {
  const services = subgraphs.map(({ name, url, dockerUrl, typeDefs }) => ({
    name,
    url: useDockerUrls ? dockerUrl : url,
    typeDefs,
  }));

  const result = composeServices(services);

  if (result.errors?.length) {
    console.error("❌ Composition errors:");
    for (const err of result.errors) {
      console.error(" -", err.message);
    }
    process.exit(1);
  }

  if (!result.supergraphSdl) {
    console.error("❌ Composition produced no SDL");
    process.exit(1);
  }

  return result.supergraphSdl;
}

const gatewayDir = join(__dirname, "../gateway");

const localSdl = compose(false);
writeFileSync(join(gatewayDir, "supergraph.graphql"), localSdl, "utf-8");
console.log("✅ Written gateway/supergraph.graphql (localhost URLs)");

const dockerSdl = compose(true);
writeFileSync(
  join(gatewayDir, "supergraph.docker.graphql"),
  dockerSdl,
  "utf-8"
);
console.log("✅ Written gateway/supergraph.docker.graphql (Docker URLs)");
