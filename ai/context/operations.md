# pdf-quiz-generator — operating contract (for humans and agents)

This is the standing guide to how this app is deployed and operated.
Instance facts (live URLs, workspace, the secrets it uses) live in
[deployment.md](deployment.md), rendered from probed reality by the
bootstrap's `02-docs` phase; this file is the contract that stays true
between deployments. It is written to give an agent with repository read
access enough context to reason about and operate the app without any
other source.

## What this system is

A PDF quiz generator served from Cloudflare — a PDF in, a four-question
multiple-choice quiz streamed back — expressed as an Orun component-native
desired-state repo.

- **`apps/web`** — Next.js built by `@opennextjs/cloudflare` into one Worker
  plus Static Assets. `/` is the template's page, pre-rendered at build;
  `POST /api/generate-quiz` takes the PDF (a data URL, 5 MB at most), turns
  it into Markdown with Workers AI (`env.AI.toMarkdown`) and streams the quiz
  from `@cf/zai-org/glm-4.7-flash` through the AI SDK and `createAI`
  (`agents/models/ai-sdk`); a server action names the quiz. With a Google key
  stored, Gemini does both instead and reads the PDF itself.
- **`tests/web`** — vitest over the quiz route (streamed from a Workers AI
  stand-in), the PDF's decoding and conversion, the model choice and its
  middleware, the template's page in jsdom, the schema and the site's
  identity. No lane lints or runs the tests: a pull request builds and
  dry-deploys the app, so run `pnpm typecheck && pnpm lint && pnpm test`
  before you push.
- **`tooling/*`** — shared TypeScript and ESLint configuration, the Worker
  secrets pusher, and the wrangler renderer for a deployable that comes to
  take wiring.

There is no infrastructure component: Workers AI is a binding on the account
the Worker deploys to (declared in `apps/web/wrangler.jsonc`, nothing to
provision), and Gemini a hosted API.

Environments: **`stage`** and **`prod`** are deployed; **`dev` is
verify-only by design** — lanes build and dry-deploy, nothing deploys.

## The models: Workers AI, or Gemini

With no key stored, the quiz runs on **Workers AI** through the Worker's `AI`
binding: the PDF's conversion, the quiz (`@cf/zai-org/glm-4.7-flash`) and its
title, billed to the Cloudflare account. Workers AI refuses a JSON-schema
response format on a streamed request, so the quiz's schema rides in its
system prompt and the answer is unfenced on its way (`apps/web/lib/ai.ts`);
the title, not streamed, uses JSON mode.

To run on **Gemini** instead (`gemini-2.5-pro` for the quiz, from the PDF
itself; `gemini-2.5-flash` for the title):

```bash
# 1. per deployed environment: a Google AI Studio key
orun secrets set GOOGLE_GENERATIVE_AI_API_KEY --env stage    # prompts for the value
# …and the same with --env prod

# 2. redeploy apps/web: the deploy pushes it to the Worker as a secret
#    (tooling/wire/worker-secrets.mjs), and setting a secret deploys nothing.
#    Deploy by hand, or change the stamp on the last line of
#    apps/web/component.yaml (`# orun: redeploy <reason> <stamp>`) and merge.
```

The key is read best-effort (`optionalSecretEnv` in
`apps/web/component.yaml`): a key nobody has stored is skipped, never a
failed lane. A wrong key is not caught at deploy: Gemini refuses the call and
the page shows its "Failed to generate quiz" toast, so make a quiz after
storing one. Delete the secret and redeploy to go back to Workers AI.

## Identity and tenancy

Every remote operation runs against ONE Orun workspace, declared in
`intent.yaml` under `execution.state.workspace` — committed, enforced, and
what CI uses. Do not remove it; headless credentials depend on it. If it
reads `ws_SET_ME`, the bootstrap had no workspace to write: set the real one
before anything else.

## How deployment works

1. Merge (or push) to `main`.
2. CI (`.github/workflows/ci.yml`) runs `orun plan --changed` — only
   components whose files changed are planned — then runs each planned lane
   with `orun run --remote-state`, authenticated by GitHub OIDC (the
   exchange resolves this repository's linked workspace server-side).
3. `apps/web` checks its committed `wrangler.jsonc` is there, builds once per
   environment with no Google key in its environment (`env -u`), pushes that
   environment's key to the Worker (if one is stored), `wrangler deploy`
   ships `pdf-quiz-generator-web-<env>` bound to Workers AI, and a smoke test
   fetches `/` and requires the upload card's "Drop your PDF here", then
   requires the quiz route to refuse an upload with no PDF with its own 400 —
   proof the Worker's server code answers, with no model asked.
4. `prod` deploys after `stage` has converged on the same commit
   (`environments.prod.promotion` in intent.yaml).
5. **The convergence run is the deployment.** A green run means every
   planned lane passed. Failed lanes are retried with
   `gh run rerun --failed`, which resumes the same execution.

On a pull request nothing deploys: the app builds and dry-deploys.

Caveats that matter:

- A push that touches no component files plans zero lanes — that run is
  green and deployed nothing. Never treat "latest run green" as "app
  converged"; probe the URLs instead.
- A change to `intent.yaml`'s `environments`, or to an Orun secret, maps to
  no component and redeploys nothing on its own. Land it with a change under
  `apps/web`.
- The page has no sign-in: anyone who reaches it can make quizzes, billed to
  the account (Workers AI) or the key (Gemini).

## Secrets model

- **Brokered provider secrets**: `CLOUDFLARE_API_TOKEN` (the
  `workers-deploy` scope) and `CLOUDFLARE_ACCOUNT_ID` — pointers minted per
  run from the workspace's Cloudflare connection. No long-lived values at
  rest; nothing to rotate by hand.
- **Workers AI** needs no secret: the binding runs on the deploying account.
- **The Google key**: `GOOGLE_GENERATIVE_AI_API_KEY` on `stage` and `prod`,
  optional, stored by the owner, pushed to the Worker as a secret by each
  deploy and read per request; no build sees it.
- Inspect by NAME only: `orun secrets list --org <ws> --env stage|prod`. No
  tooling in this repository prints a secret value, and no document in
  `ai/context/` may contain one.

## Verifying the system

```bash
# the app on each environment (also recorded, probed, in deployment.md)
curl -s https://pdf-quiz-generator-web-stage.vijayakrishnan12994.workers.dev/ | grep -o 'Drop your PDF here'
curl -s -o /dev/null -w '%{http_code}\n' https://pdf-quiz-generator-web-prod.vijayakrishnan12994.workers.dev/
# the quiz route refuses an empty upload, before any model: 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data '{}' \
  https://pdf-quiz-generator-web-prod.vijayakrishnan12994.workers.dev/api/generate-quiz

# workspace readiness
orun secrets list --org <ws> --env stage && orun secrets list --org <ws> --env prod
orun integrations list --org <ws> --json && orun cloud check --org <ws>
```

To check a model really answers, open the page and make a quiz from a small
PDF: that is the one thing no probe here does, because it spends.

## Common operations

| task | how |
|---|---|
| run on Gemini | "The models: Workers AI, or Gemini" above |
| change the model or its prompt | `apps/web/lib/ai.ts` (`WORKERS_AI_MODEL`, the Gemini ids) and `apps/web/app/api/generate-quiz/route.ts` (the teacher prompt); merge |
| change the app's code | edit `apps/web` (its name: `apps/web/app/site.ts`), merge |
| deploy a change | merge to `main`; watch the run; failed lanes → `gh run rerun --failed` |
| deploy by hand | Orunbase's Deploy button, or `gh workflow run ci.yml --ref main -f environment=<env> [-f component=<a,b>]` — the named components (blank: every one) run in that environment as a merge runs them; started off `main` it is refused |
| redeploy without a change | edit the last line of `apps/web/component.yaml` (`# orun: redeploy <reason> <stamp>`) and merge — it is a deploy trigger, nothing reads it |
| serve a custom domain | attach it to the Worker in Cloudflare (README, "Custom domain"), set `SITE_URL` in that environment's `env:` in `intent.yaml`, then replace the placeholder `pdf-quiz-generator.example.com` in `intent.yaml`'s `BASE_DOMAIN` (dev, stage and prod) with it |
| headless credentials | `ORUN_TOKEN` (workspace-scoped) + `GITHUB_TOKEN` |

The deployment record is the bootstrap's `02-docs` phase. Re-running it (the
Orun console's Retry on that phase, or `orun new … --phase 02-docs`)
re-probes the URLs and re-renders [deployment.md](deployment.md); it is
idempotent.

## Evolution

Structural changes follow the same contract that deployed the app: add a
component under `apps/`, `infra/` or `packages/` with a `component.yaml`,
land it as a pull request, and the convergence run deploys it. A component
under `infra/` whose wiring the Worker reads is declared in `apps/web`'s
`dependsOn` (enforced on `main`), so it is applied first.
