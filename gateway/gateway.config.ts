import { defineConfig, useOpenTelemetry } from "@graphql-hive/gateway";
import { usePrometheus } from "@graphql-yoga/plugin-prometheus";
import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporter as OTLPMetricExporterGrpc } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPMetricExporter as OTLPMetricExporterHttp } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter as OTLPTraceExporterGrpc } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPTraceExporter as OTLPTraceExporterHttp } from "@opentelemetry/exporter-trace-otlp-http";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_TELEMETRY_SDK_LANGUAGE,
  TELEMETRY_SDK_LANGUAGE_VALUE_NODEJS,
} from "@opentelemetry/semantic-conventions";

function getOtelExporters(endpoint: string) {
  const protocol = process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? "http/protobuf";
  if (protocol === "grpc") {
    return {
      traceExporter: new OTLPTraceExporterGrpc({ url: endpoint }),
      metricExporter: new OTLPMetricExporterGrpc({ url: endpoint }),
    };
  }
  return {
    traceExporter: new OTLPTraceExporterHttp({ url: `${endpoint}/v1/traces` }),
    metricExporter: new OTLPMetricExporterHttp({ url: `${endpoint}/v1/metrics` }),
  };
}

const otelEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const { traceExporter, metricExporter } = getOtelExporters(otelEndpoint);
const serviceName = process.env.OTEL_SERVICE_NAME || "frontis-gateway";

export const gatewayConfig = defineConfig({
  /**
   * Supergraph SDL is loaded from the file specified on the CLI.
   * Run `bun run compose` first to generate it.
   */

  /**
   * Optional: uncomment to pull the supergraph from the Hive Registry CDN
   * instead of a local file.
   *
   * hive: {
   *   endpoint: process.env.HIVE_CDN_ENDPOINT!,
   *   key: process.env.HIVE_CDN_KEY!,
   * },
   */

  healthCheckEndpoint: "/healthz",

  plugins: (ctx) => [
    useOpenTelemetry({
      exporters: [traceExporter],
      metricExporter,
      serviceName,
    }),

    usePrometheus({
      http: true,
      requestCount: true,
      requestSummary: true,
      graphqlEnvelop: {
        execute: true,
        parse: true,
        validate: true,
        contextBuilding: true,
        errors: true,
      },
    }),

    {
      onPluginInit() {
        const meter = metrics.getMeter(serviceName);
        const metricBuildInfo = `pilotariak_${serviceName.replace(/-/g, "_")}_build_info`;
        const buildInfoCounter = meter.createCounter(metricBuildInfo, {
          description: `Build information for ${serviceName}`,
        });
        buildInfoCounter.add(1, {
          [ATTR_SERVICE_NAME]: serviceName,
          [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION ?? "0.1.0",
          [ATTR_TELEMETRY_SDK_LANGUAGE]: TELEMETRY_SDK_LANGUAGE_VALUE_NODEJS,
        });
      },
    },
  ],
});
