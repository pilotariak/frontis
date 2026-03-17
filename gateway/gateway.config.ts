import { defineConfig, useOpenTelemetry, Logger, JSONLogWriter } from "@graphql-hive/gateway";
import pkg from "../package.json" with { type: "json" };
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

type LogLevel = "debug" | "info" | "warn" | "error";

function buildLogger(): Logger | LogLevel {
  const level = (process.env.LOG_LEVEL?.toLowerCase() ?? (
    process.env.NODE_ENV === "production" ? "warn" : "debug"
  )) as LogLevel;
  if (process.env.LOG_JSON === "1") {
    return new Logger({ level, writers: [new JSONLogWriter()] });
  }
  return level;
}

const otelEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const { traceExporter, metricExporter } = getOtelExporters(otelEndpoint);
const serviceName = process.env.OTEL_SERVICE_NAME || "frontis-gateway";

export const gatewayConfig = defineConfig({
  logging: buildLogger(),
  maskedErrors: process.env.NODE_ENV === "production",
  supergraph: {
    type: "hive",
    endpoint: process.env.HIVE_CDN_ENDPOINT, // ?? "https://cdn.graphql-hive.com/artifacts/v1",
    key: process.env.HIVE_CDN_TOKEN!,
  },
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
          [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION ?? pkg.version,
          [ATTR_TELEMETRY_SDK_LANGUAGE]: TELEMETRY_SDK_LANGUAGE_VALUE_NODEJS,
        });
      },
    },
  ],
});
