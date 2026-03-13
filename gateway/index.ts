import { createGatewayRuntime } from "@graphql-hive/gateway-runtime";
import http from "@graphql-mesh/transport-http";
import supergraph from "./supergraph.graphql";

const gateway = createGatewayRuntime({ supergraph, transports: { http } });

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
