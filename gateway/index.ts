import { createGatewayRuntime } from "@graphql-hive/gateway-runtime";
import http from "@graphql-mesh/transport-http";
import supergraph from "./supergraph.graphql";

const gateway = createGatewayRuntime({
  supergraph,
  transports: { http },
  plugins: () => [
    {
      onFetch({ options, setOptions, context }: {
        options: RequestInit;
        setOptions: (opts: RequestInit) => void;
        context: { request?: Request };
      }) {
        const league = context?.request?.headers?.get("x-league");
        if (league) {
          setOptions({
            ...options,
            headers: {
              ...(options.headers as Record<string, string> ?? {}),
              "x-league": league,
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
    const response = await gateway(request, env, ctx);
    ctx.waitUntil(gateway[Symbol.asyncDispose]());
    return response;
  },
};
