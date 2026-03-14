import { metrics } from "@opentelemetry/api";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { OTLPMetricExporter as OTLPMetricExporterGrpc } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPMetricExporter as OTLPMetricExporterHttp } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter as OTLPTraceExporterGrpc } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPTraceExporter as OTLPTraceExporterHttp } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import type { PushMetricExporter } from "@opentelemetry/sdk-metrics";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

function getExporters(endpoint: string): {
  traceExporter: SpanExporter;
  metricExporter: PushMetricExporter;
} {
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

export function setupTracing(serviceName: string): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? serviceName,
  });

  const { traceExporter, metricExporter } = getExporters(endpoint);

  const tracerProvider = new NodeTracerProvider({ resource });
  tracerProvider.addSpanProcessor(new BatchSpanProcessor(traceExporter));
  tracerProvider.register();

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 10_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);
}
