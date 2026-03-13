/**
 * Type declaration for *.graphql text imports.
 * Wrangler (esbuild) inlines these as strings at bundle time via wrangler.jsonc rules.
 */
declare module "*.graphql" {
  const content: string;
  export default content;
}

declare module "*.html" {
  const content: string;
  export default content;
}
