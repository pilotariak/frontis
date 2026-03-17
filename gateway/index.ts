import { createGatewayRuntime, useRateLimit } from "@graphql-hive/gateway";
import CFWorkerKVCache from "@graphql-mesh/cache-cfw-kv";
import * as httpTransport from "@graphql-mesh/transport-http";
import landingPage from "./index.html";
import {
  createMaxDepthRule,
  createMaxTokensRule,
  createMaxDirectivesRule,
} from "./validation.js";

// Maps worker names to their service binding keys in env
const SERVICE_BINDING_MAP: Record<string, string> = {
  "frontis-echo": "ECHO",
  "frontis-specialties": "SPECIALTIES",
  "frontis-clubs": "CLUBS",
  "frontis-competitions": "COMPETITIONS",
  "frontis-results": "RESULTS",
};

// Routes fetch calls to subgraph workers.dev URLs through CF Service Bindings.
// Worker-to-Worker HTTP calls via workers.dev do not work within CF's network;
// service bindings provide direct in-network Worker-to-Worker communication.
function serviceBindingFetch(env: any) {
  return function (url: string, init?: RequestInit): Promise<Response> {
    const hostname = new URL(url).hostname; // e.g. frontis-echo.nicolas-lamirault.workers.dev
    const workerName = hostname.split(".")[0]; // e.g. frontis-echo
    const binding = SERVICE_BINDING_MAP[workerName];
    if (binding) {
      if (!env[binding]) {
        throw new Error(`Service binding ${binding} missing in env for worker: ${workerName}`);
      }
      const headers = new Headers((init?.headers as HeadersInit) ?? {});
      headers.set("x-internal-token", env.INTERNAL_SERVICE_TOKEN);
      return env[binding].fetch(new Request(url, { ...init, headers }));
    }
    // Not a known subgraph — fall through to global fetch (e.g. Hive CDN)
    return globalThis.fetch(url, init);
  };
}

// Let gateway be initialized lazily to use environment variables in Module Worker mode
let gateway: ReturnType<typeof createGatewayRuntime>;

export default {
  async fetch(
    request: Request,
    env: any,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(landingPage, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "GET" && url.pathname === "/healthz") {
      return new Response(JSON.stringify({ status: "ok", environment: env.ENVIRONMENT ?? "unknown" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET" && url.pathname === "/readyz") {
      const ready = gateway != null;
      return new Response(JSON.stringify({ status: "ok", ready }), {
        status: ready ? 200 : 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!env.INTERNAL_SERVICE_TOKEN) {
      return new Response("Gateway misconfigured: INTERNAL_SERVICE_TOKEN not set", { status: 500 });
    }

    if (!gateway) {
      const maxDepth = parseInt(env.GRAPHQL_MAX_DEPTH ?? "7", 10);
      const maxTokens = parseInt(env.GRAPHQL_MAX_TOKENS ?? "1000", 10);
      const maxDirectives = parseInt(env.GRAPHQL_MAX_DIRECTIVES ?? "10", 10);

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
        { type: "Query", field: "clubs",        max: rateLimitMaxList, ttl: rateLimitWindowMs, identifier: clientIdentifier },
        { type: "Query", field: "competitions", max: rateLimitMaxList, ttl: rateLimitWindowMs, identifier: clientIdentifier },
        { type: "Query", field: "results",      max: rateLimitMaxList, ttl: rateLimitWindowMs, identifier: clientIdentifier },
        { type: "Query", field: "specialties",  max: rateLimitMaxList, ttl: rateLimitWindowMs, identifier: clientIdentifier },
        // Single-item queries — higher limit
        { type: "Query", field: "club",         max: rateLimitMaxItem, ttl: rateLimitWindowMs, identifier: clientIdentifier },
        { type: "Query", field: "competition",  max: rateLimitMaxItem, ttl: rateLimitWindowMs, identifier: clientIdentifier },
        { type: "Query", field: "result",       max: rateLimitMaxItem, ttl: rateLimitWindowMs, identifier: clientIdentifier },
        { type: "Query", field: "specialty",    max: rateLimitMaxItem, ttl: rateLimitWindowMs, identifier: clientIdentifier },
      ];

      const rateLimitCache = env.RATE_LIMIT_CACHE
        ? new CFWorkerKVCache({ namespace: env.RATE_LIMIT_CACHE })
        : undefined;

      gateway = createGatewayRuntime({
        logging: true,
        transports: {
          http: httpTransport,
        },
        fetchAPI: {
          fetch: serviceBindingFetch(env),
        },
        supergraph: {
          type: "hive",
          endpoint: env.HIVE_CDN_ENDPOINT || "https://cdn.graphql-hive.com/artifacts/v1",
          key: env.HIVE_CDN_TOKEN,
        },
        cache: env.SUPERGRAPH_CACHE
          ? new CFWorkerKVCache({ namespace: env.SUPERGRAPH_CACHE })
          : undefined,
        pollingInterval: 30_000,
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
            },
          },
          {
            onFetch({ options, setOptions, context }: {
              options: RequestInit;
              setOptions: (opts: RequestInit) => void;
              context: { request?: Request };
            }) {
              const league = context?.request?.headers?.get("x-pilotariak-league");
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
    }

    const response = await gateway.fetch(request, env, ctx);
    return response;
  },
};
