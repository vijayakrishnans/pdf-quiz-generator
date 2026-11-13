import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAI } from "agents/models/ai-sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  extractJsonMiddleware,
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from "ai";

// The Workers AI model the quiz and its title run on when no Google key is
// stored: GLM-4.7-Flash (131,072-token context), through the Worker's own AI
// binding, with no key.
export const WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash";

// Upstream's Gemini 1.5 Pro and Flash are retired; the owner's optional
// Google key runs their current stable successors.
export const GEMINI_QUIZ_MODEL = "gemini-2.5-pro";
export const GEMINI_TITLE_MODEL = "gemini-2.5-flash";

// The longest document text sent to Workers AI: about 50,000 tokens, well
// inside the model's context window with room for the four questions.
export const MAX_DOCUMENT_CHARS = 200_000;

export type AiEnv = {
  AI?: CloudflareEnv["AI"];
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
};

// The Worker's bindings and secrets, read per request. Without a Cloudflare
// context (`next dev`, the tests) they are environment variables.
export function aiEnv(): AiEnv {
  try {
    return getCloudflareContext().env as AiEnv;
  } catch {
    return process.env as AiEnv;
  }
}

export function googleKey(env: AiEnv): string | undefined {
  const key = env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  return key ? key : undefined;
}

// Workers AI refuses a JSON-schema response format on a streaming request,
// so a STREAMED structured call moves the schema into the system prompt
// instead and sends no response format; a non-streamed one keeps JSON mode.
export const schemaInPromptMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v4",
  transformParams: async ({ type, params }) => {
    const format = params.responseFormat;
    if (type !== "stream" || format?.type !== "json" || !format.schema) {
      return params;
    }
    const instruction =
      "Answer with JSON only: a single JSON value matching this JSON Schema, " +
      "with no other text and no code fence.\n" +
      JSON.stringify(format.schema);
    const [first, ...rest] = params.prompt;
    const prompt =
      first?.role === "system"
        ? [{ ...first, content: `${first.content}\n\n${instruction}` }, ...rest]
        : [{ role: "system" as const, content: instruction }, ...params.prompt];
    return { ...params, responseFormat: { type: "text" }, prompt };
  },
};

export function workersAiModel(binding: NonNullable<AiEnv["AI"]>): LanguageModel {
  const ai = createAI({ binding });
  return wrapLanguageModel({
    model: ai(WORKERS_AI_MODEL),
    // Fenced or bare, the model's JSON reaches the parser as bare JSON.
    middleware: [schemaInPromptMiddleware, extractJsonMiddleware()],
  });
}

export type ModelChoice =
  | { provider: "google"; model: LanguageModel; id: string }
  | { provider: "workers-ai"; model: LanguageModel; id: string };

// The quiz's model: Gemini when the owner stored a Google key (it reads the
// PDF itself, as upstream did), else Workers AI over the document's Markdown.
export function quizModel(env: AiEnv): ModelChoice {
  const key = googleKey(env);
  if (key) {
    const google = createGoogleGenerativeAI({ apiKey: key });
    return { provider: "google", model: google(GEMINI_QUIZ_MODEL), id: GEMINI_QUIZ_MODEL };
  }
  if (!env.AI) throw new WorkersAiUnboundError();
  return { provider: "workers-ai", model: workersAiModel(env.AI), id: WORKERS_AI_MODEL };
}

export function titleModel(env: AiEnv): ModelChoice {
  const key = googleKey(env);
  if (key) {
    const google = createGoogleGenerativeAI({ apiKey: key });
    return { provider: "google", model: google(GEMINI_TITLE_MODEL), id: GEMINI_TITLE_MODEL };
  }
  if (!env.AI) throw new WorkersAiUnboundError();
  return { provider: "workers-ai", model: workersAiModel(env.AI), id: WORKERS_AI_MODEL };
}

export class WorkersAiUnboundError extends Error {
  constructor() {
    super("Workers AI is not bound: run the app as a Worker (wrangler dev or a deployment).");
    this.name = "WorkersAiUnboundError";
  }
}
