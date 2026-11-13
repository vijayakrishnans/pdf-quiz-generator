// lib/ai.ts: which model the quiz and its title run on, and the middleware
// that keeps a streamed structured call off Workers AI's JSON mode.
import { afterEach, describe, expect, it } from "vitest";
import {
  aiEnv,
  GEMINI_QUIZ_MODEL,
  GEMINI_TITLE_MODEL,
  quizModel,
  schemaInPromptMiddleware,
  titleModel,
  WORKERS_AI_MODEL,
  WorkersAiUnboundError,
} from "@/lib/ai";
import { clearCloudflareContext, fakeAI, setCloudflareContext } from "./fake-ai";

afterEach(clearCloudflareContext);

const AI = fakeAI().binding as unknown as NonNullable<ReturnType<typeof aiEnv>["AI"]>;

describe("the model", () => {
  it("is Workers AI through the binding when no Google key is stored", () => {
    const quiz = quizModel({ AI });
    expect(quiz.provider).toBe("workers-ai");
    expect(quiz.id).toBe(WORKERS_AI_MODEL);
    expect(WORKERS_AI_MODEL).toBe("@cf/zai-org/glm-4.7-flash");
    expect(titleModel({ AI }).provider).toBe("workers-ai");
  });

  it("is Gemini when the owner stored a Google key: Pro for the quiz, Flash for the title", () => {
    const env = { AI, GOOGLE_GENERATIVE_AI_API_KEY: "test-key" };
    const quiz = quizModel(env);
    const title = titleModel(env);
    expect([quiz.provider, quiz.id]).toEqual(["google", GEMINI_QUIZ_MODEL]);
    expect([title.provider, title.id]).toEqual(["google", GEMINI_TITLE_MODEL]);
    expect(GEMINI_QUIZ_MODEL).toBe("gemini-2.5-pro");
    expect(GEMINI_TITLE_MODEL).toBe("gemini-2.5-flash");
    const model = quiz.model as { provider: string; modelId: string };
    expect(model.provider).toMatch(/^google/);
    expect(model.modelId).toBe("gemini-2.5-pro");
  });

  it("treats a blank key as no key", () => {
    expect(quizModel({ AI, GOOGLE_GENERATIVE_AI_API_KEY: "  " }).provider).toBe("workers-ai");
  });

  it("refuses to pick Workers AI with no binding (next dev), with an error the route turns into a 503", () => {
    expect(() => quizModel({})).toThrow(WorkersAiUnboundError);
    expect(() => titleModel({})).toThrow(WorkersAiUnboundError);
  });

  it("reads the Worker's env per request, and process.env without a Cloudflare context", () => {
    setCloudflareContext({ AI, GOOGLE_GENERATIVE_AI_API_KEY: "from-worker" });
    expect(aiEnv().GOOGLE_GENERATIVE_AI_API_KEY).toBe("from-worker");
    clearCloudflareContext();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "from-process";
    try {
      expect(aiEnv().GOOGLE_GENERATIVE_AI_API_KEY).toBe("from-process");
    } finally {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    }
  });
});

describe("schemaInPromptMiddleware", () => {
  const schema = { type: "object", properties: { elements: { type: "array" } } };
  const transform = schemaInPromptMiddleware.transformParams!;
  const call = (type: "stream" | "generate", params: Record<string, unknown>) =>
    transform({ type, params: params as never, model: {} as never });

  it("moves a streamed call's JSON schema into the system prompt and sends no response format", async () => {
    const out = (await call("stream", {
      responseFormat: { type: "json", schema },
      prompt: [
        { role: "system", content: "You are a teacher." },
        { role: "user", content: [{ type: "text", text: "Quiz me." }] },
      ],
    })) as { responseFormat: unknown; prompt: { role: string; content: unknown }[] };
    expect(out.responseFormat).toEqual({ type: "text" });
    expect(out.prompt).toHaveLength(2);
    expect(out.prompt[0]!.role).toBe("system");
    expect(out.prompt[0]!.content).toMatch(/^You are a teacher\.\n\nAnswer with JSON only/);
    expect(out.prompt[0]!.content).toContain(JSON.stringify(schema));
    expect(out.prompt[1]!.role).toBe("user");
  });

  it("adds a system message when the call has none", async () => {
    const out = (await call("stream", {
      responseFormat: { type: "json", schema },
      prompt: [{ role: "user", content: [{ type: "text", text: "Quiz me." }] }],
    })) as { prompt: { role: string; content: unknown }[] };
    expect(out.prompt.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("leaves a non-streamed call in JSON mode, and a plain text call alone", async () => {
    const generate = { responseFormat: { type: "json", schema }, prompt: [] };
    expect(await call("generate", generate)).toBe(generate);
    const text = { responseFormat: { type: "text" }, prompt: [] };
    expect(await call("stream", text)).toBe(text);
  });
});
