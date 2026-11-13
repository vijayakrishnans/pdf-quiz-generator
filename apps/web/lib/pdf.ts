import { MAX_DOCUMENT_CHARS, type AiEnv } from "./ai";

// The page's own limit (app/(preview)/page.tsx): PDFs of 5 MB or less.
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

export type UploadedFile = { name?: string; type?: string; data?: string };

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

// The page sends each file as a data URL (FileReader.readAsDataURL).
export function decodePdf(file: UploadedFile | undefined): { name: string; bytes: Uint8Array<ArrayBuffer> } {
  const data = file?.data;
  if (typeof data !== "string") throw new UploadError("No PDF was sent.", 400);
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(data);
  if (!match || !match[2]) throw new UploadError("The file is not a base64 data URL.", 400);
  if (match[1] !== "application/pdf") throw new UploadError("Only PDF files are allowed.", 415);
  let binary: string;
  try {
    binary = atob(match[3] ?? "");
  } catch {
    throw new UploadError("The file is not valid base64.", 400);
  }
  if (binary.length > MAX_PDF_BYTES) throw new UploadError("Only PDF files under 5MB are allowed.", 413);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!binary.startsWith("%PDF-")) throw new UploadError("The file is not a PDF.", 415);
  return { name: file?.name || "document.pdf", bytes };
}

// The PDF's text as Markdown, by Workers AI's document conversion
// (env.AI.toMarkdown), cut to what the model reads.
export async function pdfToMarkdown(
  ai: NonNullable<AiEnv["AI"]>,
  pdf: { name: string; bytes: Uint8Array<ArrayBuffer> },
): Promise<string> {
  const result = await ai.toMarkdown({
    name: pdf.name,
    blob: new Blob([pdf.bytes], { type: "application/pdf" }),
  });
  const doc = Array.isArray(result) ? result[0] : result;
  if (!doc || doc.format === "error" || typeof doc.data !== "string") {
    throw new UploadError("The PDF could not be read.", 422);
  }
  const text = doc.data.trim();
  if (!text) throw new UploadError("The PDF has no text to make a quiz from.", 422);
  return text.length > MAX_DOCUMENT_CHARS ? text.slice(0, MAX_DOCUMENT_CHARS) : text;
}
