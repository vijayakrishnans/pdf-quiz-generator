// lib/pdf.ts: the upload's data URL into bytes, and the PDF into Markdown.
import { describe, expect, it } from "vitest";
import { decodePdf, MAX_PDF_BYTES, pdfToMarkdown, UploadError } from "@/lib/pdf";
import { MAX_DOCUMENT_CHARS } from "@/lib/ai";
import { dataUrl, fakeAI, makePdf } from "./fake-ai";

type Binding = Parameters<typeof pdfToMarkdown>[0];

describe("decodePdf", () => {
  it("decodes the page's data URL into the PDF's bytes", () => {
    const pdf = makePdf(["Hello"]);
    const out = decodePdf({ name: "hello.pdf", data: dataUrl(pdf) });
    expect(out.name).toBe("hello.pdf");
    expect(Array.from(out.bytes)).toEqual(Array.from(pdf));
  });

  it("names an unnamed file", () => {
    expect(decodePdf({ data: dataUrl(makePdf(["x"])) }).name).toBe("document.pdf");
  });

  it("refuses what is not a PDF, or too big, with the status the route answers", () => {
    const status = (f: Parameters<typeof decodePdf>[0]) => {
      try {
        decodePdf(f);
      } catch (e) {
        expect(e).toBeInstanceOf(UploadError);
        return (e as UploadError).status;
      }
      return 200;
    };
    expect(status(undefined)).toBe(400);
    expect(status({ data: "data:application/pdf,%25PDF-" })).toBe(400);
    expect(status({ data: "data:application/pdf;base64,***" })).toBe(400);
    expect(status({ data: dataUrl(new TextEncoder().encode("hi"), "text/plain") })).toBe(415);
    expect(status({ data: dataUrl(new TextEncoder().encode("hi")) })).toBe(415);
    expect(status({ data: dataUrl(new Uint8Array(MAX_PDF_BYTES + 1)) })).toBe(413);
    expect(MAX_PDF_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("pdfToMarkdown", () => {
  it("asks Workers AI's conversion for the PDF's Markdown", async () => {
    const ai = fakeAI();
    const md = await pdfToMarkdown(ai.binding as unknown as Binding, { name: "a.pdf", bytes: makePdf(["One line"]) });
    expect(md).toBe("## Contents\n\nOne line");
    expect(ai.calls).toMatchObject([{ kind: "toMarkdown", name: "a.pdf" }]);
  });

  it("takes a single result as well as a list", async () => {
    const binding = { toMarkdown: async () => ({ name: "a.pdf", format: "markdown", data: " text " }) } as unknown as Binding;
    expect(await pdfToMarkdown(binding, { name: "a.pdf", bytes: makePdf(["x"]) })).toBe("text");
  });

  it("cuts a long document to what the model reads", async () => {
    const binding = { toMarkdown: async () => [{ name: "a.pdf", format: "markdown", data: "y".repeat(MAX_DOCUMENT_CHARS + 50) }] } as unknown as Binding;
    expect((await pdfToMarkdown(binding, { name: "a.pdf", bytes: makePdf(["x"]) })).length).toBe(MAX_DOCUMENT_CHARS);
  });

  it("refuses a failed conversion and an empty document with a 422", async () => {
    for (const result of [[{ name: "a.pdf", format: "error", error: "x" }], [{ name: "a.pdf", format: "markdown", data: "  " }], []]) {
      const binding = { toMarkdown: async () => result } as unknown as Binding;
      await expect(pdfToMarkdown(binding, { name: "a.pdf", bytes: makePdf(["x"]) })).rejects.toMatchObject({ status: 422 });
    }
  });
});
