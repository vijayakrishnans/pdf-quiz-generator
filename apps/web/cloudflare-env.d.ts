// The bindings wrangler.jsonc declares and the Worker secret the deploy
// pushes, as the Worker sees them. Declared by hand: a global
// @cloudflare/workers-types would retype Request and Response app-wide.
interface AiMarkdownDocument {
  name: string;
  blob: Blob;
}
interface AiMarkdownResult {
  id?: string;
  name: string;
  mimeType?: string;
  format: "markdown" | "text" | "error";
  tokens?: number;
  data?: string;
  error?: string;
}
interface AiBinding {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  toMarkdown(
    files: AiMarkdownDocument | AiMarkdownDocument[],
    options?: Record<string, unknown>,
  ): Promise<AiMarkdownResult | AiMarkdownResult[]>;
}
interface CloudflareEnv {
  ASSETS: { fetch(input: Request | string | URL, init?: RequestInit): Promise<Response> };
  AI: AiBinding;
  // Optional: the quiz runs on Workers AI without it.
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
}
