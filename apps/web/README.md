# PDF Quiz Generator, on Workers

Upload a PDF and get a four-question multiple-choice quiz about it, from
Vercel's [PDF to Quiz Generator](https://github.com/vercel-labs/ai-sdk-preview-pdf-support)
(vercel-labs/ai-sdk-preview-pdf-support, Apache-2.0), running on Cloudflare
Workers + Static Assets:

- The page (`app/(preview)/page.tsx`) reads the PDF in the browser (5 MB at
  most), posts it to `/api/generate-quiz`, and shows each question as it
  streams in, with the template's progress bar, then the quiz, its score and
  its review
- The route (`app/api/generate-quiz/route.ts`) turns the PDF into Markdown with
  Workers AI's document conversion (`env.AI.toMarkdown`, `lib/pdf.ts`) and
  streams the questions from Workers AI (`@cf/zai-org/glm-4.7-flash`) through
  the AI SDK, with `createAI` from `agents/models/ai-sdk` over the Worker's own
  `AI` binding — no key
- The quiz's title comes from a server action (`app/(preview)/actions.ts`) on
  the same model
- With the owner's optional `GOOGLE_GENERATIVE_AI_API_KEY`, both run on Google's
  Gemini instead (`gemini-2.5-pro`, `gemini-2.5-flash`), which reads the PDF
  itself, as upstream did (`lib/ai.ts`)

The site's name and source link are in `app/site.ts`.

```bash
pnpm dev        # next dev on http://localhost:3000 (no Workers AI: quizzes need .env.local's Google key)
pnpm build      # next build + opennextjs-cloudflare build → .open-next/
pnpm preview    # wrangler dev over the built Worker (Workers AI needs `wrangler login`)
```

How it is deployed — per environment, on merge to `main` — and how the Google
key is connected is the repository's README and `component.yaml` beside this
file.
