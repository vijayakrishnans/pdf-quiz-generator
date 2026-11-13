// The template's own lint rules (its .eslintrc.json: `next/core-web-vitals`),
// in ESLint 9's flat config through FlatCompat, as Next.js 15 documents.
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: [".next/**", ".open-next/**", ".wrangler/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals"),
];

export default config;
