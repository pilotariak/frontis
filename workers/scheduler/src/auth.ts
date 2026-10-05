// SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
// SPDX-License-Identifier: Apache-2.0

/**
 * Guard for the worker's HTTP endpoints.
 *
 * Every write path of this worker (`/scrape_infos`, `/scrape_results`) hits
 * the production D1 databases and the upstream league websites, so the HTTP
 * surface is restricted to callers that present the shared
 * `INTERNAL_SERVICE_TOKEN` in the `x-internal-token` header, exactly like the
 * subgraphs do for the gateway. The cron trigger (`scheduled()`) does not go
 * through this check; its self-calls forward the token.
 *
 * Returns `null` when the request is authorised, otherwise the `Response` to
 * send back. Fails closed: a worker without the secret rejects every request.
 */
export function requireInternalToken(request: Request, expected: string | undefined): Response | null {
  if (!expected) {
    console.error("[auth] INTERNAL_SERVICE_TOKEN is not set — check .dev.vars or `wrangler secret put`");
    return new Response("Worker misconfigured: INTERNAL_SERVICE_TOKEN not set", { status: 500 });
  }
  const given = request.headers.get("x-internal-token");
  if (!given || !timingSafeEqual(given, expected)) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

/**
 * Constant-time string comparison: XOR every byte and OR the results so the
 * run time does not depend on the position of the first mismatch. Length is
 * not secret here (the token is a fixed-size random hex string).
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < bufA.byteLength; i++) {
    diff |= bufA[i]! ^ bufB[i]!;
  }
  return diff === 0;
}
