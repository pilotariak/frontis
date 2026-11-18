// SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import {
  GraphQLError,
  defaultFieldResolver,
  responsePathAsArray,
} from "graphql";
import type { GraphQLResolveInfo, GraphQLSchema } from "graphql";

/**
 * The part of a Workers Rate Limiting binding this plugin uses.
 * See https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Root Query fields that are rate limited, by binding. List fields return
 * broad result sets and get the lower limit; single-item lookups get the
 * higher one. The limits themselves live in `[[ratelimits]]` in wrangler.toml.
 */
export const RATE_LIMITED_FIELDS = {
  list: [
    "categories",
    "clubs",
    "competitions",
    "results",
    "rankings",
    "playerRankings",
    "specialties",
  ],
  item: ["category", "club", "competition", "result", "teamRanking", "specialty"],
} as const;

/** Must match `period` of the `[[ratelimits]]` bindings in wrangler.toml. */
export const RATE_LIMIT_PERIOD_SECONDS = 60;

export interface RateLimitPluginOptions {
  list?: RateLimiter;
  item?: RateLimiter;
  logger?: Pick<Console, "error">;
}

/**
 * Identifies the client. `cf-connecting-ip` is set by Cloudflare and cannot be
 * forged by the client, unlike `x-forwarded-for`, which Cloudflare appends to
 * rather than replaces. The fallbacks only apply outside Cloudflare's edge
 * (local development, tests).
 */
export function clientIdentifier(headers: Headers | undefined): string {
  return (
    headers?.get("cf-connecting-ip") ||
    headers?.get("x-forwarded-for") ||
    headers?.get("host") ||
    "unknown"
  );
}

function rateLimitError(
  field: string,
  client: string,
  info: GraphQLResolveInfo
): GraphQLError {
  // Same error as the previous @graphql-mesh/plugin-rate-limit setup. Yoga
  // reads `http.status`, not `statusCode`, so the HTTP status stays 200 and
  // the error is reported in the GraphQL response body.
  return new GraphQLError(
    `Rate limit of "Query.${field}" exceeded for "${client}"`,
    {
      nodes: info.fieldNodes,
      path: responsePathAsArray(info.path),
      extensions: {
        http: {
          statusCode: 429,
          headers: { "Retry-After": String(RATE_LIMIT_PERIOD_SECONDS) },
        },
      },
    }
  );
}

/**
 * Envelop plugin that rate limits root Query fields with Workers Rate Limiting
 * bindings. It wraps each configured field's resolver, so every resolver call
 * (each alias included) counts once, and only the over-limit field fails: the
 * other root fields of the operation still resolve.
 *
 * Fails open: if `limit()` throws, the error is logged and the field resolves.
 */
export function createRateLimitPlugin({
  list,
  item,
  logger = console,
}: RateLimitPluginOptions) {
  const limiters = new Map<string, RateLimiter>();
  for (const field of RATE_LIMITED_FIELDS.list) if (list) limiters.set(field, list);
  for (const field of RATE_LIMITED_FIELDS.item) if (item) limiters.set(field, item);

  // onSchemaChange can fire more than once for the same schema; wrapping a
  // resolver twice would count every call twice.
  const wrapped = new WeakSet<object>();

  return {
    onSchemaChange({ schema }: { schema: GraphQLSchema }) {
      const fields = schema.getQueryType()?.getFields() ?? {};
      for (const [name, limiter] of limiters) {
        const field = fields[name];
        if (!field || wrapped.has(field)) continue;
        wrapped.add(field);

        const resolve = field.resolve ?? defaultFieldResolver;
        field.resolve = async (source, args, context, info) => {
          const client = clientIdentifier(
            (context as { request?: Request } | undefined)?.request?.headers
          );
          let success = true;
          try {
            ({ success } = await limiter.limit({ key: `${client}:${name}` }));
          } catch (error) {
            logger.error(
              `[gateway] rate limiter failed for Query.${name}, allowing the request`,
              error
            );
          }
          if (!success) throw rateLimitError(name, client, info);
          return resolve(source, args, context, info);
        };
      }
    },
  };
}
