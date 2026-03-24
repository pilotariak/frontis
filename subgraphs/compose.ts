/**
 * Composes the supergraph SDL from all subgraph schemas using
 * @theguild/federation-composition (no Rover CLI required).
 *
 * Generates three output files:
 *   - ../gateway/supergraph.graphql          (localhost URLs — local dev)
 *   - ../gateway/supergraph.docker.graphql   (Docker network hostnames)
 *   - ../gateway/supergraph.workers.graphql  (Cloudflare Workers URLs)
 *
 * Workers URLs default to <name>.workers.dev — override by setting env vars:
 *   WORKERS_SUBDOMAIN=<your-account-subdomain> bun run compose:workers
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

const subdomain = process.env.WORKERS_SUBDOMAIN ?? "your-account";

const subgraphs = [
  {
    name: "echo",
    url: "http://localhost:4001/graphql",
    dockerUrl: "http://echo_subgraph:4001/graphql",
    workerUrl: `https://frontis-echo.${subdomain}.workers.dev/graphql`,
    typeDefs: readSchema("echo"),
  },
  {
    name: "specialties",
    url: "http://localhost:4004/graphql",
    dockerUrl: "http://specialties_subgraph:4004/graphql",
    workerUrl: `https://frontis-specialties.${subdomain}.workers.dev/graphql`,
    typeDefs: readSchema("specialties"),
  },
  {
    name: "clubs",
    url: "http://localhost:4003/graphql",
    dockerUrl: "http://clubs_subgraph:4003/graphql",
    workerUrl: `https://frontis-clubs.${subdomain}.workers.dev/graphql`,
    typeDefs: readSchema("clubs"),
  },
  {
    name: "competitions",
    url: "http://localhost:4002/graphql",
    dockerUrl: "http://competitions_subgraph:4002/graphql",
    workerUrl: `https://frontis-competitions.${subdomain}.workers.dev/graphql`,
    typeDefs: readSchema("competitions"),
  },
  {
    name: "categories",
    url: "http://localhost:4006/graphql",
    dockerUrl: "http://categories_subgraph:4006/graphql",
    workerUrl: `https://frontis-categories.${subdomain}.workers.dev/graphql`,
    typeDefs: readSchema("categories"),
  },
  {
    name: "results",
    url: "http://localhost:4005/graphql",
    dockerUrl: "http://results_subgraph:4005/graphql",
    workerUrl: `https://frontis-results.${subdomain}.workers.dev/graphql`,
    typeDefs: readSchema("results"),
  },
];

type UrlMode = "local" | "docker" | "workers";

function compose(mode: UrlMode): string {
  const services = subgraphs.map(({ name, url, dockerUrl, workerUrl, typeDefs }) => ({
    name,
    url: mode === "docker" ? dockerUrl : mode === "workers" ? workerUrl : url,
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

const localSdl = compose("local");
writeFileSync(join(gatewayDir, "supergraph.graphql"), localSdl, "utf-8");
console.log("✅ Written gateway/supergraph.graphql (localhost URLs)");

const dockerSdl = compose("docker");
writeFileSync(join(gatewayDir, "supergraph.docker.graphql"), dockerSdl, "utf-8");
console.log("✅ Written gateway/supergraph.docker.graphql (Docker URLs)");

const workersSdl = compose("workers");
writeFileSync(join(gatewayDir, "supergraph.workers.graphql"), workersSdl, "utf-8");
console.log(`✅ Written gateway/supergraph.workers.graphql (Workers URLs — subdomain: ${subdomain})`);
