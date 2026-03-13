import { defineConfig } from "@graphql-hive/gateway";

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

  plugins: (ctx) => [
    /**
     * Optional: OpenTelemetry — export traces to Jaeger or any OTLP endpoint.
     *
     * useOpenTelemetry({
     *   exporters: [new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })],
     *   serviceName: "pilotariak-gateway",
     * }),
     */

    /**
     * Optional: Prometheus metrics endpoint at /metrics.
     *
     * usePrometheus({
     *   http: true,
     *   requestCount: true,
     *   requestSummary: true,
     * }),
     */
  ],
});
