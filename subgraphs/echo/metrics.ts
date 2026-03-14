import { metrics } from "@opentelemetry/api";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_TELEMETRY_SDK_LANGUAGE,
  TELEMETRY_SDK_LANGUAGE_VALUE_NODEJS,
} from "@opentelemetry/semantic-conventions";
import {
  ATTR_GRAPHQL_OPERATION_NAME,
  ATTR_GRAPHQL_OPERATION_TYPE,
} from "@opentelemetry/semantic-conventions/incubating";
import type { OperationDefinitionNode } from "graphql";
import type { Plugin } from "graphql-yoga";
import pkg from "../../package.json";

export function useSubgraphMetrics(serviceName: string): Plugin {
  const meter = metrics.getMeter("graphql.subgraph");

  const metricBuildInfo = `pilotariak_${serviceName.replace(/-/g, "_")}_build_info`;
  const buildInfoCounter = meter.createCounter(metricBuildInfo, {
    description: `Build information for ${serviceName}`,
  });
  buildInfoCounter.add(1, {
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: pkg.version,
    [ATTR_TELEMETRY_SDK_LANGUAGE]: TELEMETRY_SDK_LANGUAGE_VALUE_NODEJS,
  });

  const operationCounter = meter.createCounter("graphql.operation.count", {
    description: "Total number of GraphQL operations executed",
  });
  const errorCounter = meter.createCounter("graphql.error.count", {
    description: "Total number of GraphQL errors",
  });
  const durationHistogram = meter.createHistogram("graphql.operation.duration_ms", {
    description: "Duration of GraphQL operations in milliseconds",
    unit: "ms",
  });

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onExecute({ args }: any) {
      const start = performance.now();
      const operationName: string = args.operationName ?? "anonymous";
      const firstDef = args.document?.definitions?.[0] as OperationDefinitionNode | undefined;
      const operationType: string = firstDef?.operation ?? "query";

      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onExecuteDone({ result }: any) {
          const attrs = {
            [ATTR_GRAPHQL_OPERATION_NAME]: operationName,
            [ATTR_GRAPHQL_OPERATION_TYPE]: operationType,
          };
          operationCounter.add(1, attrs);
          durationHistogram.record(performance.now() - start, attrs);
          if (result.errors?.length) {
            errorCounter.add(result.errors.length, attrs);
          }
        },
      };
    },
  };
}

export function withHttpMetrics<TArgs extends unknown[]>(
  handler: (request: Request, ...args: TArgs) => Response | Promise<Response>
): (request: Request, ...args: TArgs) => Promise<Response> {
  const meter = metrics.getMeter("http.server");

  const requestCounter = meter.createCounter("http.server.request.count", {
    description: "Total number of HTTP requests",
  });
  const durationHistogram = meter.createHistogram("http.server.request.duration_ms", {
    description: "Duration of HTTP requests in milliseconds",
    unit: "ms",
  });

  return async (request: Request, ...args: TArgs): Promise<Response> => {
    const start = performance.now();
    const url = new URL(request.url);
    let statusCode = 200;

    try {
      const response = await handler(request, ...args);
      statusCode = response.status;
      return response;
    } catch (error) {
      statusCode = 500;
      throw error;
    } finally {
      const duration = performance.now() - start;
      const routeAttrs = {
        [ATTR_HTTP_REQUEST_METHOD]: request.method,
        [ATTR_HTTP_ROUTE]: url.pathname,
      };
      requestCounter.add(1, { ...routeAttrs, [ATTR_HTTP_RESPONSE_STATUS_CODE]: statusCode });
      durationHistogram.record(duration, routeAttrs);
    }
  };
}
