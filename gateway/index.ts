import { createGatewayRuntime } from "@graphql-hive/gateway-runtime";
import http from "@graphql-mesh/transport-http";
import landingPage from "./index.html";
import supergraph from "./supergraph.graphql";

const gateway = createGatewayRuntime({
  supergraph,
  landingPage: false,
  graphiql: false,
  transports: { http },
  plugins: () => [
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

export default {
  async fetch(
    request: Request,
    env: Record<string, unknown>,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(landingPage, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    const response = await gateway(request, env, ctx);
    ctx.waitUntil(gateway[Symbol.asyncDispose]());
    return response;
  },
};
