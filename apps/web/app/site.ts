// The site's identity, written once. The page's title and heading read
// SITE_NAME; its "View Source Code" and "Deploy your own" links read
// SOURCE_URL. Instantiation rewrites both to the product's own name and
// repository, so keep them literal and on one line each.
// prettier-ignore
export const SITE_NAME = "Pdf Quiz Generator";
// prettier-ignore
export const SOURCE_URL = "https://github.com/sourceplane/pdf-quiz-generator";

// The site's public origin (metadataBase, the Open Graph URLs), without a
// trailing slash. The deploy sets NEXT_PUBLIC_SITE_URL per environment
// (component.yaml); unset, it is http://localhost:3000.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
