// OpenNext Cloudflare adapter config.
//
// The page is pre-rendered at build (it is a client component that streams its
// quiz from /api/generate-quiz), and the quiz route renders per request. The
// static-assets incremental cache serves what the build pre-rendered from the
// Worker's static assets, with no R2, KV or D1 to provision. The build copies
// that cache into place itself (scripts/populate-static-assets-cache.mjs):
// `opennextjs-cloudflare populateCache` would open a remote session for the AI
// binding, and a build needs no credential.
import { defineCloudflareConfig } from "@opennextjs/cloudflare/config";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
