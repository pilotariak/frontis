import { AsyncLocalStorage } from "node:async_hooks";
import { createGatewayRuntime, useRateLimit } from "@graphql-hive/gateway";
import CFWorkerKVCache from "@graphql-mesh/cache-cfw-kv";
import * as httpTransport from "@graphql-mesh/transport-http";
import landingPage from "./index.html";
import rootPkg from "../package.json" with { type: "json" };
import localSupergraph from "./supergraph.graphql";
import {
  createMaxDepthRule,
  createMaxTokensRule,
  createMaxDirectivesRule,
  createCostAnalysisRule,
  type CostMap,
} from "./validation.js";

// Schema-specific demand control cost map.
//
// Costs reflect relative subgraph call expense:
//   - Trivial scalars (echo, version):       0
//   - Single-item lookups (club, specialty):  2–10
//   - List root queries (clubs, results):    15–60  (one call per list + N entity resolutions)
//   - Cross-subgraph entity fields in Result: 4 each (competition, specialty, clubA, clubB)
//   - Cross-subgraph nested list (Competition.results): 20
//
// With maxCost=1000 a typical query costs ~20–200; a 10× aliased expensive
// query costs 600–800, and truly pathological queries are rejected.
const DEMAND_CONTROL_COST_MAP: CostMap = {
  Query: {
    echo: 0,
    version: 0,
    category: 2,
    club: 2,
    specialty: 2,
    competition: 5,
    result: 10,
    categories: 15,
    clubs: 15,
    specialties: 15,
    competitions: 25,
    results: 60,
  },
  Competition: {
    // Triggers cross-subgraph entity resolution for every result item
    results: 20,
  },
  Result: {
    // Each field triggers a cross-subgraph entity lookup
    competition: 4,
    specialty: 4,
    clubA: 4,
    clubB: 4,
    clubALineup: 2,
    clubBLineup: 2,
  },
};

// Maps worker names to their service binding keys in env
const SERVICE_BINDING_MAP: Record<string, string> = {
  "frontis-echo": "ECHO",
  "frontis-specialties": "SPECIALTIES",
  "frontis-clubs": "CLUBS",
  "frontis-competitions": "COMPETITIONS",
  "frontis-categories": "CATEGORIES",
  "frontis-results": "RESULTS",
};

// Holds the env for the currently executing request.
// Service bindings are request-scoped in Cloudflare Workers: they must be
// called within the same I/O context as the request that provided env.
// Using AsyncLocalStorage ensures each request's fetch calls use its own env
// rather than the env captured at gateway initialization time.
const envStorage = new AsyncLocalStorage<any>();

// Routes fetch calls to subgraph workers.dev URLs through CF Service Bindings.
// Worker-to-Worker HTTP calls via workers.dev do not work within CF's network;
// service bindings provide direct in-network Worker-to-Worker communication.
function serviceBindingFetch(url: string, init?: RequestInit): Promise<Response> {
  const env = envStorage.getStore();
  const hostname = new URL(url).hostname; // e.g. frontis-echo.nicolas-lamirault.workers.dev
  const workerName = hostname.split(".")[0]; // e.g. frontis-echo
  const binding = SERVICE_BINDING_MAP[workerName];
  console.debug(`[gateway] serviceBindingFetch url=${url} workerName=${workerName} binding=${binding ?? "(none)"} hasEnv=${!!env}`);
  if (binding && env) {
    if (!env[binding]) {
      console.error(`[gateway] Service binding '${binding}' missing in env for worker: ${workerName}`);
      throw new Error(`Service binding ${binding} missing in env for worker: ${workerName}`);
    }
    const hasToken = !!env.INTERNAL_SERVICE_TOKEN;
    console.debug(`[gateway] Forwarding to binding ${binding} hasInternalToken=${hasToken}`);
    const headers = new Headers((init?.headers as HeadersInit) ?? {});
    headers.set("x-internal-token", env.INTERNAL_SERVICE_TOKEN);
    return env[binding].fetch(new Request(url, { ...init, headers }));
  }
  // Not a known service binding — fall through to global fetch (local dev subgraphs or Hive CDN).
  // Still inject the internal token so local subgraphs (localhost:*) accept the request.
  console.debug(`[gateway] No binding for ${workerName}, using globalThis.fetch`);
  if (env?.INTERNAL_SERVICE_TOKEN) {
    const headers = new Headers((init?.headers as HeadersInit) ?? {});
    headers.set("x-internal-token", env.INTERNAL_SERVICE_TOKEN);
    return globalThis.fetch(url, { ...init, headers });
  }
  return globalThis.fetch(url, init);
}

type LogLevel = "debug" | "info" | "warn" | "error";

function getLogLevel(env: any): LogLevel {
  const level = env.LOG_LEVEL?.toLowerCase();
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }
  return env.ENVIRONMENT === "production" ? "warn" : "debug";
}

export default {
  async fetch(
    request: Request,
    env: any,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      const html = (landingPage as string).replace("__FRONTIS_VERSION__", `v${rootPkg.version}`);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "GET" && url.pathname === "/healthz") {
      return new Response(JSON.stringify({ status: "ok", environment: env.ENVIRONMENT ?? "unknown" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET" && url.pathname === "/readyz") {
      return new Response(JSON.stringify({ status: "ok", ready: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    console.debug(`[gateway] request method=${request.method} path=${url.pathname}`);
    console.debug(`[gateway] env keys present: INTERNAL_SERVICE_TOKEN=${!!env.INTERNAL_SERVICE_TOKEN} HIVE_CDN_TOKEN=${!!env.HIVE_CDN_TOKEN} HIVE_CDN_ENDPOINT=${!!env.HIVE_CDN_ENDPOINT} ENVIRONMENT=${env.ENVIRONMENT ?? "(unset)"}`);

    if (!env.INTERNAL_SERVICE_TOKEN) {
      console.error("[gateway] INTERNAL_SERVICE_TOKEN is not set — check .dev.vars or wrangler secret");
      return new Response("Gateway misconfigured: INTERNAL_SERVICE_TOKEN not set", { status: 500 });
    }

    const maxDepth = parseInt(env.GRAPHQL_MAX_DEPTH ?? "7", 10);
    const maxTokens = parseInt(env.GRAPHQL_MAX_TOKENS ?? "1000", 10);
    const maxDirectives = parseInt(env.GRAPHQL_MAX_DIRECTIVES ?? "10", 10);
    const maxCost = parseInt(env.GRAPHQL_MAX_COST ?? "1000", 10);

    // Rate limit windows (ms) and max requests per window per client IP
    const rateLimitWindowMs = parseInt(env.RATE_LIMIT_WINDOW_MS ?? "60000", 10);
    const rateLimitMaxList = parseInt(env.RATE_LIMIT_MAX_LIST ?? "60", 10);
    const rateLimitMaxItem = parseInt(env.RATE_LIMIT_MAX_ITEM ?? "120", 10);

    // Identify clients by Cloudflare's authoritative IP header, falling back to x-forwarded-for
    const clientIdentifier =
      "{context.headers.cf-connecting-ip}" +
      "|{context.headers.x-forwarded-for}" +
      "|{context.headers.host}";

    const rateLimitConfig = [
      // List queries — broader result sets, lower limit
      { type: "Query", field: "categories",   max: rateLimitMaxList, ttl: rateLimitWindowMs, identifier: clientIdentifier },
      { type: "Query", field: "clubs",        max: rateLimitMaxList, ttl: rateLimitWindowMs, identifier: clientIdentifier },
      { type: "Query", field: "competitions", max: rateLimitMaxList, ttl: rateLimitWindowMs, identifier: clientIdentifier },
      { type: "Query", field: "results",      max: rateLimitMaxList, ttl: rateLimitWindowMs, identifier: clientIdentifier },
      { type: "Query", field: "specialties",  max: rateLimitMaxList, ttl: rateLimitWindowMs, identifier: clientIdentifier },
      // Single-item queries — higher limit
      { type: "Query", field: "category",     max: rateLimitMaxItem, ttl: rateLimitWindowMs, identifier: clientIdentifier },
      { type: "Query", field: "club",         max: rateLimitMaxItem, ttl: rateLimitWindowMs, identifier: clientIdentifier },
      { type: "Query", field: "competition",  max: rateLimitMaxItem, ttl: rateLimitWindowMs, identifier: clientIdentifier },
      { type: "Query", field: "result",       max: rateLimitMaxItem, ttl: rateLimitWindowMs, identifier: clientIdentifier },
      { type: "Query", field: "specialty",    max: rateLimitMaxItem, ttl: rateLimitWindowMs, identifier: clientIdentifier },
    ];

    const rateLimitCache = env.RATE_LIMIT_CACHE
      ? new CFWorkerKVCache({ namespace: env.RATE_LIMIT_CACHE })
      : undefined;

    // The gateway is created per-request to avoid cross-request I/O context
    // issues in CF Workers. The Hive Gateway runtime accumulates request-scoped
    // I/O objects (AbortSignals, response streams) during processing; reusing a
    // singleton across requests triggers "Cannot perform I/O on behalf of a
    // different request" (RefcountedCanceler). With SUPERGRAPH_CACHE backed by
    // KV, the supergraph schema is read from the KV cache (~1-3 ms) on each
    // call, making per-request creation cheap.
    const gateway = createGatewayRuntime({
      logging: getLogLevel(env),
      maskedErrors: env.ENVIRONMENT === "production",
      transports: {
        http: httpTransport,
      },
      fetchAPI: {
        fetch: serviceBindingFetch,
      },
      supergraph: env.HIVE_CDN_TOKEN
        ? {
            type: "hive" as const,
            endpoint: env.HIVE_CDN_ENDPOINT || "https://cdn.graphql-hive.com/artifacts/v1",
            key: env.HIVE_CDN_TOKEN,
          }
        : localSupergraph,
      cache: env.SUPERGRAPH_CACHE
        ? new CFWorkerKVCache({ namespace: env.SUPERGRAPH_CACHE })
        : undefined,
      landingPage: false,
      graphiql: false,
      disableIntrospection: env.ENVIRONMENT === "production" ? {} : undefined,
      plugins: () => [
        ...(rateLimitCache
          ? [useRateLimit({ config: rateLimitConfig, cache: rateLimitCache }) as any]
          : []),
        {
          onValidate({ addValidationRule }: { addValidationRule: (rule: unknown) => void }) {
            addValidationRule(createMaxDepthRule(maxDepth));
            addValidationRule(createMaxTokensRule(maxTokens));
            addValidationRule(createMaxDirectivesRule(maxDirectives));
            addValidationRule(createCostAnalysisRule(maxCost, DEMAND_CONTROL_COST_MAP));
          },
        },
        {
          onFetch({ options, setOptions, context }: {
            options: RequestInit;
            setOptions: (opts: RequestInit) => void;
            context: { request?: Request };
          }) {
            const league = context?.request?.headers?.get("x-pilotariak-league");
            console.debug(`[gateway] onFetch league=${league ?? "(not set)"} url=${(options as any).url ?? "(unknown)"}`);
            if (league) {
              setOptions({
                ...options,
                headers: {
                  ...(options.headers as Record<string, string> ?? {}),
                  "x-pilotariak-league": league,
                },
              });
            }
          },
        },
      ],
    });

    return envStorage.run(env, () => gateway.fetch(request, env, ctx));
  },
};
