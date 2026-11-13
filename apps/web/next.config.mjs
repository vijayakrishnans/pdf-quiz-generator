import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required by @opennextjs/cloudflare, which bundles `.next/standalone/**`
  // into the Worker. Traced from the monorepo root, so the workspace's
  // dependencies resolve from the root node_modules.
  output: "standalone",
  outputFileTracingRoot: path.join(here, "../.."),
  // The page's only images are its icons and the Open Graph card: nothing for
  // an image optimiser to do, so the Worker carries none.
  images: { unoptimized: true },
  // Dev server only (`next build` ignores it): orun.work's live Preview tab
  // loads `next dev` from the preview's own host, and Next.js refuses the hot
  // reload and other /_next/* dev requests from an origin it is not told about.
  allowedDevOrigins: ["*.orun-preview.app", "preview-gateway-stage.oruncloud.workers.dev"],
};

export default nextConfig;
