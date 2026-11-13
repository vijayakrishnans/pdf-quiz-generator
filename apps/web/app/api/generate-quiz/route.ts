import { questionSchema, questionsSchema } from "@/lib/schemas";
import { aiEnv, quizModel, WorkersAiUnboundError } from "@/lib/ai";
import { decodePdf, pdfToMarkdown, UploadError, type UploadedFile } from "@/lib/pdf";
import { streamObject, type LanguageModel, type ModelMessage } from "ai";

export const maxDuration = 60;

const SYSTEM =
  "You are a teacher. Your job is to take a document, and create a multiple choice test (with 4 questions) based on the content of the document. Each option should be roughly equal in length.";

export async function POST(req: Request) {
  let messages: ModelMessage[];
  let model: LanguageModel;
  try {
    const { files } = (await req.json()) as { files?: UploadedFile[] };
    const pdf = decodePdf(files?.[0]);
    const env = aiEnv();
    const choice = quizModel(env);
    model = choice.model;
    if (choice.provider === "google") {
      // Upstream's path: Gemini reads the PDF itself.
      messages = [
        {
          role: "user",
          content: [
            { type: "text", text: "Create a multiple choice test based on this document." },
            { type: "file", data: pdf.bytes, mediaType: "application/pdf" },
          ],
        },
      ];
    } else {
      // Workers AI reads text: the PDF becomes Markdown first.
      const markdown = await pdfToMarkdown(env.AI!, pdf);
      messages = [
        {
          role: "user",
          content: `Create a multiple choice test based on this document.\n\n<document name="${pdf.name.replace(/"/g, "'")}">\n${markdown}\n</document>`,
        },
      ];
    }
  } catch (error) {
    if (error instanceof UploadError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof WorkersAiUnboundError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: "The request body is not JSON." }, { status: 400 });
    }
    throw error;
  }

  const result = streamObject({
    model,
    // AI SDK 7 takes the system prompt as `instructions`, not a system message.
    instructions: SYSTEM,
    messages,
    schema: questionSchema,
    output: "array",
    onFinish: ({ object }) => {
      const res = questionsSchema.safeParse(object);
      if (res.error) {
        throw new Error(res.error.issues.map((e) => e.message).join("\n"));
      }
    },
  });

  return result.toTextStreamResponse();
}
