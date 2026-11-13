// A deterministic stand-in for the Worker's Workers AI binding, with the two
// methods the app calls, answering in Workers AI's own shapes:
//
// - toMarkdown(files): the document's text as a ConversionResult — read from
//   the uploaded PDF's `(…) Tj` text operators, so what the quiz is built
//   from really came out of the bytes the route was sent;
// - run(model, inputs, { returnRawResponse }): a raw Response, as createAI
//   asks for — a JSON chat completion, or for `stream: true` the server-sent
//   event hybrid Workers AI streams (OpenAI delta chunks, then a
//   `{ response: "", usage }` tail, then [DONE]). The streamed answer is
//   fenced (```json), as models often write it, and arrives in small chunks.
//
// What it proves is the app's half: the conversion call, the prompt, the
// provider, the streamed parse. Whether a real model answers is only proven
// by a deployment.

export type FakeCall = {
  kind: "toMarkdown" | "run";
  model?: string;
  stream?: boolean;
  responseFormat?: string | null;
  system?: string;
  user?: string;
  name?: string;
  bytes?: number;
};

type Doc = { name: string; blob: Blob };

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

export function pdfLines(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  for (const m of latin1(bytes).matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
    lines.push((m[1] ?? "").replace(/\\([()\\])/g, "$1"));
  }
  return lines;
}

// A one-page PDF whose text is `lines`, one `(…) Tj` each (standard PDF 1.4).
export function makePdf(lines: string[]): Uint8Array<ArrayBuffer> {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const ops = ["BT", "/F1 12 Tf", "72 720 Td", "16 TL", ...lines.flatMap((l) => [`(${esc(l)}) Tj`, "T*"]), "ET"];
  const content = ops.join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(new ArrayBuffer(out.length));
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return bytes;
}

export const dataUrl = (bytes: Uint8Array, type = "application/pdf") =>
  `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;

export function fakeAI(options: { delayMs?: number; answer?: (doc: string) => string } = {}) {
  const calls: FakeCall[] = [];
  const delayMs = options.delayMs ?? 5;

  const binding = {
    async toMarkdown(files: Doc | Doc[]) {
      const list = Array.isArray(files) ? files : [files];
      const out = [];
      for (const [i, file] of list.entries()) {
        const bytes = new Uint8Array(await file.blob.arrayBuffer());
        calls.push({ kind: "toMarkdown", name: file.name, bytes: bytes.length });
        if (latin1(bytes.slice(0, 5)) !== "%PDF-") {
          out.push({ id: `doc-${i}`, name: file.name, format: "error" as const, error: "Unsupported file" });
          continue;
        }
        const data = `## Contents\n\n${pdfLines(bytes).join("\n\n")}\n`;
        out.push({ id: `doc-${i}`, name: file.name, mimeType: "application/pdf", format: "markdown" as const, tokens: 10, data });
      }
      return Array.isArray(files) ? out : out[0]!;
    },

    async run(model: string, inputs: Record<string, unknown>, opts?: Record<string, unknown>) {
      const messages = (Array.isArray(inputs.messages) ? inputs.messages : []) as { role: string; content: unknown }[];
      const text = (role: string) =>
        messages
          .filter((m) => m.role === role)
          .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
          .join("\n");
      const format = inputs.response_format as { type?: string } | undefined;
      calls.push({
        kind: "run",
        model,
        stream: Boolean(inputs.stream),
        responseFormat: format?.type ?? null,
        system: text("system"),
        user: text("user"),
      });
      if (!opts?.returnRawResponse) throw new Error("createAI always asks for the raw response");
      const usage = { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 };
      const id = `chatcmpl-${calls.length}`;
      const created = 1_700_000_000;

      if (!inputs.stream) {
        const name = (text("user").split("\n").pop() ?? "").trim();
        const title = name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ") || "quiz";
        const body = {
          id,
          object: "chat.completion",
          created,
          model,
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ title }) }, finish_reason: "stop" }],
          usage,
        };
        return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      }

      const doc = /<document[^>]*>\n([\s\S]*?)\n<\/document>/.exec(text("user"))?.[1] ?? "";
      const answer = options.answer ? options.answer(doc) : "```json\n" + JSON.stringify({ elements: quizFrom(doc) }) + "\n```";
      const pieces = answer.match(/[\s\S]{1,24}/g) ?? [];
      const enc = new TextEncoder();
      const event = (o: unknown) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
      let i = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (i < pieces.length) {
            await new Promise((r) => setTimeout(r, delayMs));
            controller.enqueue(
              event({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: pieces[i] }, finish_reason: null }], usage }),
            );
            i++;
            return;
          }
          controller.enqueue(event({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
          controller.enqueue(event({ id, object: "chat.completion.chunk", created, model, choices: [], usage }));
          controller.enqueue(event({ response: "", usage }));
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  };
  return { binding, calls };
}

// Four questions, one per line of the document, the right answer rotating
// through A–D.
export function quizFrom(doc: string) {
  const lines = doc
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const letters = ["A", "B", "C", "D"] as const;
  return [0, 1, 2, 3].map((i) => {
    const options = [`Not stated ${i}a`, `Not stated ${i}b`, `Not stated ${i}c`];
    options.splice(i, 0, lines[i % Math.max(lines.length, 1)] ?? "the document");
    return { question: `Question ${i + 1}: which line does the document contain?`, options, answer: letters[i]! };
  });
}

const CONTEXT = Symbol.for("__cloudflare-context__");

// What getCloudflareContext() returns inside the Worker, for the duration of
// a test (clearCloudflareContext in afterEach).
export function setCloudflareContext(env: Record<string, unknown>) {
  (globalThis as Record<symbol, unknown>)[CONTEXT] = { env, ctx: {}, cf: {} };
}

export function clearCloudflareContext() {
  delete (globalThis as Record<symbol, unknown>)[CONTEXT];
}
