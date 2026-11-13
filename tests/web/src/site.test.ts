// The site's identity (app/site.ts) and the Worker's configuration: what the
// deploy and the instantiation rely on.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { SITE_NAME, SITE_URL, SOURCE_URL } from "@/app/site";
import type { NextConfig } from "next";

const web = path.resolve(__dirname, "../../../apps/web");
const read = (f: string) => fs.readFileSync(path.join(web, f), "utf8");
const { default: nextConfig } = (await import(path.join(web, "next.config.mjs"))) as { default: NextConfig };

describe("the site's identity", () => {
  it("is one literal line each, as the instantiation rewrites it", () => {
    const site = read("app/site.ts");
    expect(site).toMatch(/^export const SITE_NAME = "[^"\n]+";$/m);
    expect(site).toMatch(/^export const SOURCE_URL = "https:\/\/github\.com\/[^"\n]+";$/m);
    expect(site).toContain(`export const SITE_NAME = ${JSON.stringify(SITE_NAME)};`);
    expect(SOURCE_URL).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
  });

  it("serves from the environment's origin, localhost without one", () => {
    expect(SITE_URL).toBe((process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, ""));
  });
});

describe("the Worker", () => {
  const wrangler = JSON.parse(read("wrangler.jsonc").replace(/^\s*\/\/.*$/gm, ""));

  it("binds Workers AI as AI, and the static assets as ASSETS", () => {
    expect(wrangler.ai).toEqual({ binding: "AI" });
    expect(wrangler.assets).toEqual({ directory: ".open-next/assets", binding: "ASSETS" });
    expect(wrangler.main).toBe(".open-next/worker.js");
    expect(wrangler.compatibility_flags).toContain("nodejs_compat");
  });

  it("is built by OpenNext from a standalone Next.js build", () => {
    expect(nextConfig.output).toBe("standalone");
    expect(nextConfig.images?.unoptimized).toBe(true);
  });

  it("copies the pre-rendered pages into its static assets without opening a Cloudflare session", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.build).toContain("node scripts/populate-static-assets-cache.mjs");
    expect(pkg.scripts.build).not.toContain("populateCache");
    expect(read("open-next.config.ts")).toContain("staticAssetsIncrementalCache");
  });

  it("keeps the PDF limit the page states: 5 MB", () => {
    expect(read("app/(preview)/page.tsx")).toContain("file.size <= 5 * 1024 * 1024");
  });
});
