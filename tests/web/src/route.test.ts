// The quiz route, run as the Worker runs it: getCloudflareContext() answers
// with a Workers AI binding (fake-ai.ts), and the route streams the quiz
// through createAI, the schema-in-prompt middleware and the AI SDK.
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/generate-quiz/route";
import { questionsSchema } from "@/lib/schemas";
import { WORKERS_AI_MODEL } from "@/lib/ai";
import { clearCloudflareContext, dataUrl, fakeAI, makePdf, setCloudflareContext } from "./fake-ai";

const LINES = [
  "The Zephyr pelican crosses Lake Orvel every April.",
  "Its wings span three metres and carry it far each day.",
  "Marsh reeds at Orvel feed the flock on the way north.",
  "Rangers count the pelicans from the Kestrel tower.",
];

const request = (body: unknown) =>
  new Request("http://localhost/api/generate-quiz", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const upload = (bytes: Uint8Array, name = "zephyr-pelicans.pdf", type = "application/pdf") => ({
  files: [{ name, type, data: dataUrl(bytes, type) }],
});

// Reads a text stream to its end, noting how much had arrived by when.
async function readTimed(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const chunks: { at: number; text: string }[] = [];
  const t0 = Date.now();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push({ at: Date.now() - t0, text: dec.decode(value, { stream: true }) });
  }
  return chunks;
}

afterEach(clearCloudflareContext);

describe("POST /api/generate-quiz on Workers AI", () => {
  it("streams four questions built from the PDF's own text, the first before the stream ends", async () => {
    const ai = fakeAI({ delayMs: 15 });
    setCloudflareContext({ AI: ai.binding });
    const res = await POST(request(upload(makePdf(LINES))));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);

    const chunks = await readTimed(res);
    expect(chunks.length).toBeGreaterThan(2);
    const text = chunks.map((c) => c.text).join("");
    // The answer was fenced; the client gets bare JSON: the bare array
    // upstream's useObject({ schema: questionsSchema }) parses.
    expect(text.startsWith("[")).toBe(true);
    const quiz = questionsSchema.parse(JSON.parse(text));
    expect(quiz.map((q) => q.answer)).toEqual(["A", "B", "C", "D"]);
    expect(quiz[0]!.options[0]).toBe(LINES[0]);
    expect(quiz[3]!.options[3]).toBe(LINES[3]);

    // A whole question had arrived while the stream was still open.
    let sofar = "";
    const firstComplete = chunks.findIndex((c) => (sofar += c.text).includes('"answer"'));
    expect(firstComplete).toBeGreaterThanOrEqual(0);
    expect(firstComplete).toBeLessThan(chunks.length - 1);
  });

  it("converts the uploaded bytes, then streams with the schema in the prompt and no response format", async () => {
    const ai = fakeAI();
    setCloudflareContext({ AI: ai.binding });
    const pdf = makePdf(LINES);
    await readTimed(await POST(request(upload(pdf))));

    const [convert, run] = ai.calls;
    expect(convert).toMatchObject({ kind: "toMarkdown", name: "zephyr-pelicans.pdf", bytes: pdf.length });
    expect(run).toMatchObject({ kind: "run", model: WORKERS_AI_MODEL, stream: true, responseFormat: null });
    // Upstream's teacher prompt, then the JSON Schema of the array's wrapper.
    expect(run!.system).toMatch(/^You are a teacher\./);
    expect(run!.system).toContain("Answer with JSON only");
    expect(run!.system).toContain('"elements"');
    // The document reached the model as the PDF's text.
    expect(run!.user).toContain('<document name="zephyr-pelicans.pdf">');
    for (const line of LINES) expect(run!.user).toContain(line);
  });

  it("caps the document text the model reads", async () => {
    const ai = fakeAI();
    setCloudflareContext({ AI: ai.binding });
    const long = Array.from({ length: 3000 }, (_, i) => `Line ${i} `.padEnd(100, "x"));
    await readTimed(await POST(request(upload(makePdf(long)))));
    const doc = /<document[^>]*>\n([\s\S]*?)\n<\/document>/.exec(ai.calls[1]!.user!)?.[1] ?? "";
    expect(doc.length).toBe(200_000);
  });

  it("answers a stream that is not a quiz with no questions (the page shows its error toast)", async () => {
    const ai = fakeAI({ answer: () => "I cannot make a quiz from this." });
    setCloudflareContext({ AI: ai.binding });
    const text = (await readTimed(await POST(request(upload(makePdf(LINES)))))).map((c) => c.text).join("");
    let quiz = false;
    try {
      quiz = questionsSchema.safeParse(JSON.parse(text)).success;
    } catch {
      // not JSON at all: the page's useObject fails to parse it, as upstream's did
    }
    expect(quiz).toBe(false);
  });
});

describe("POST /api/generate-quiz refuses what it cannot quiz", () => {
  const cases: [string, unknown, number, RegExp][] = [
    ["a body that is not JSON", "{nope", 400, /not JSON/],
    ["no file", {}, 400, /No PDF/],
    ["a file that is not a data URL", { files: [{ name: "a.pdf", data: "hello" }] }, 400, /data URL/],
    ["a data URL that is not a PDF", upload(new TextEncoder().encode("hello"), "a.txt", "text/plain"), 415, /Only PDF/],
    ["a PDF type around bytes that are not a PDF", upload(new TextEncoder().encode("hello")), 415, /not a PDF/],
    ["a PDF over 5 MB", upload(new Uint8Array(5 * 1024 * 1024 + 1).fill(37)), 413, /under 5MB/],
  ];
  for (const [name, body, status, message] of cases) {
    it(`${name}: ${status}`, async () => {
      const ai = fakeAI();
      setCloudflareContext({ AI: ai.binding });
      const res = await POST(request(body));
      expect(res.status).toBe(status);
      expect(((await res.json()) as { error: string }).error).toMatch(message);
      expect(ai.calls).toEqual([]);
    });
  }

  it("a PDF the conversion cannot read: 422, and no model call", async () => {
    const ai = fakeAI();
    setCloudflareContext({
      AI: { ...ai.binding, toMarkdown: async () => [{ name: "x.pdf", format: "error", error: "bad" }] },
    });
    const res = await POST(request(upload(makePdf(LINES))));
    expect(res.status).toBe(422);
    expect(ai.calls.filter((c) => c.kind === "run")).toEqual([]);
  });

  it("a PDF whose conversion has no text: 422, and no model call", async () => {
    const ai = fakeAI();
    setCloudflareContext({
      AI: { ...ai.binding, toMarkdown: async () => [{ name: "x.pdf", format: "markdown", data: "  \n " }] },
    });
    const res = await POST(request(upload(makePdf([]))));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/no text/);
    expect(ai.calls).toEqual([]);
  });

  it("no Workers AI binding and no Google key (next dev): 503, never a 500", async () => {
    setCloudflareContext({});
    const res = await POST(request(upload(makePdf(LINES))));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/Workers AI is not bound/);
  });
});
