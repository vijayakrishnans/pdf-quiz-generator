# pdf-quiz-generator

Upload a PDF and get a four-question multiple-choice quiz about it — each
question shown as it streams in, then the quiz, its score and its review —
running on **Cloudflare Workers + Static Assets** through
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare). Workers AI
reads the PDF and writes the quiz, through the Worker's own binding, with no
model key. It is Vercel's
[PDF to Quiz Generator](https://github.com/vercel-labs/ai-sdk-preview-pdf-support)
template (the AI SDK's PDF example), ported to Workers.

## Live deployment

<!-- 02-docs:begin -->
Not recorded yet. The bootstrap's last phase writes the live URLs, the
workspace and the secrets the app uses into
[ai/context/deployment.md](ai/context/deployment.md); how the app deploys
and how to operate it is in
[ai/context/operations.md](ai/context/operations.md).
<!-- 02-docs:end -->

## How a quiz is made

1. The page (`app/(preview)/page.tsx`) reads the PDF in the browser — a PDF of
   5 MB at most — and posts it to `/api/generate-quiz`.
2. The route (`app/api/generate-quiz/route.ts`) checks it is a PDF of 5 MB at
   most, then asks **Workers AI** to turn it into Markdown
   (`env.AI.toMarkdown`, `lib/pdf.ts`) — the first 200,000 characters of it
   are what the model reads.
3. It streams four questions from **`@cf/zai-org/glm-4.7-flash`** on Workers
   AI, through the AI SDK and Cloudflare's provider, `createAI` from
   `agents/models/ai-sdk` (`lib/ai.ts`). The page shows each question as it
   arrives, then the quiz.
4. A server action (`app/(preview)/actions.ts`) names the quiz from the PDF's
   file name, on the same model.

Workers AI runs on the Cloudflare account the Worker deploys to, and is billed
there (it has a free daily allowance); nothing else is needed.

## Use Google's Gemini

The template ran on Google's Gemini, which reads a PDF itself. With a Google
AI Studio key, this app does too — `gemini-2.5-pro` writes the quiz from the
PDF, and `gemini-2.5-flash` names it — and Workers AI is not used:

1. **Create a key** at [aistudio.google.com](https://aistudio.google.com/apikey).
2. **Store it**, once per deployed environment. It is this repository's Orun
   secret, and stage and prod can each have their own:

   ```bash
   orun secrets set GOOGLE_GENERATIVE_AI_API_KEY --env stage   # prompts for the value
   orun secrets set GOOGLE_GENERATIVE_AI_API_KEY --env prod
   ```

3. **Redeploy the app**: setting a secret deploys nothing. Use **Deploy by
   hand** below, or change the stamp on the last line of
   `apps/web/component.yaml` (`# orun: redeploy …`) and merge. The deploy
   pushes the key to the Worker as a secret (`pdf-quiz-generator-web-stage`,
   `pdf-quiz-generator-web-prod`), never into a build, and the quiz route reads it
   per request. Delete the secret and redeploy to go back to Workers AI.

## What is here

| Surface | Where |
|---|---|
| The page: upload, streamed progress, the quiz, its score and review | `apps/web/app/(preview)/page.tsx`, `apps/web/components` |
| The quiz route, and the PDF's decoding and conversion | `apps/web/app/api/generate-quiz/route.ts`, `apps/web/lib/pdf.ts` |
| The quiz's title | `apps/web/app/(preview)/actions.ts` |
| Which model runs (Workers AI, or Gemini with a key) | `apps/web/lib/ai.ts` |
| The quiz's shape: four questions, four options, one answer | `apps/web/lib/schemas.ts` |
| The site's name and source link | `apps/web/app/site.ts` |
| Workers build and deploy contract | `apps/web/next.config.mjs`, `open-next.config.ts`, `wrangler.jsonc`, `component.yaml` |
| Tests | `tests/web` (vitest) |

## Getting started

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build            # next build + opennextjs-cloudflare build → apps/web/.open-next
```

That needs no Cloudflare account and no key, and is what to run before you
push: a pull request builds the app but does not lint or run its tests.
Workers AI has no local mode, so to make a quiz on your machine either log in
to Cloudflare and preview the built Worker, or give `next dev` a Google key:

```bash
cd apps/web
npx wrangler login                # Workers AI runs on your account, even in wrangler dev
pnpm build && pnpm preview        # wrangler dev over the built Worker
# — or —
cp .env.example .env.local        # GOOGLE_GENERATIVE_AI_API_KEY
pnpm dev                          # http://localhost:3000, quizzes on Gemini
```

| Variable | Read | What it does |
|---|---|---|
| `AI` (binding) | request time, in the Worker | Workers AI: the PDF's conversion and, with no Google key, the quiz and its title. Declared in `wrangler.jsonc`; nothing to provision. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | request time, in the Worker | Optional. Deployed Workers get it from the secret of their environment, pushed by each deploy. Set, the quiz runs on Gemini. |
| `NEXT_PUBLIC_SITE_URL` | build time | The site's public origin, for its Open Graph image. The deploy sets it per environment; not a secret. |

## How it deploys

Merges to `main` converge through [Orun](https://github.com/sourceplane/orun):
`.github/workflows/ci.yml` plans the changed components and runs each lane
against the workspace in `intent.yaml`. The app builds once per environment —
with no Google key in its environment, so no bundle can carry one — then
pushes that environment's key (if one is stored) to the Worker and deploys:
to `stage`, then to `prod` once stage has converged on the same commit; `dev`
only verifies. The Worker is `pdf-quiz-generator-web-<env>` on your account's
workers.dev subdomain, bound to Workers AI, and every deploy is smoke-tested
over HTTP: the page must render, and the quiz route must refuse an upload
with no PDF (its own 400 — no model is asked, so the smoke costs nothing). A
pull request runs the same pipeline's verify lanes: the app built and
dry-deployed for each environment, with nothing deployed and no secret
pushed. They do not lint or run the tests, so run `pnpm typecheck`,
`pnpm lint` and `pnpm test` before you push. (A push to `main` builds,
deploys and smoke-tests.)

The pipeline holds one credential, GitHub's own `GITHUB_TOKEN`. The
Cloudflare token and account id are brokered per run from the workspace's
Cloudflare connection; nothing provider-shaped is stored in the repository
or in GitHub.

**Deploy by hand.** Orunbase's **Deploy** button on a component, or **Run
workflow** on the CI workflow in GitHub's Actions tab (on `main`), runs
`ci.yml` for the environment and components you pick, and each one deploys
exactly as a merge would deploy it. Leave the component blank to redeploy
every component in that environment, with nothing changed: after storing or
rotating the Google key, say. A component with nothing to run in that
environment (a test suite in `prod`) is left out with a notice.

**Limits.** A Worker has no wall-clock limit while the page is connected, so
a long quiz streams to the end; its CPU time is limited (10 ms a request on
Workers Free, 30 s on Paid), and decoding a PDF of several megabytes may need
Workers Paid. A quiz on Workers AI is billed to the account, and the page has
no sign-in: anyone who can reach it can make quizzes.

## Custom domain

The app answers on workers.dev from its first deploy. To serve it on your
own domain, add the domain to the Cloudflare account the app deploys into
and attach it to the Worker (dashboard → Workers & Pages →
`pdf-quiz-generator-web-prod` → Settings → Domains & Routes → Add → Custom domain).
The app's Open Graph image names its origin, so set
`SITE_URL: https://<your domain>` in that environment's `env:` in
`intent.yaml` — the next deploy builds with it. The repository also names the
domain as `BASE_DOMAIN` in `intent.yaml` (dev, stage and prod), which the app
was born with as the reserved placeholder `pdf-quiz-generator.example.com`.
Replace it with your domain in the same change.
