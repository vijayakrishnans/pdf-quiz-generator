// @vitest-environment jsdom
//
// The page, the template's own client component, in a browser DOM: a PDF is
// chosen, the quiz streams in from /api/generate-quiz (its progress shown as
// each question arrives), then the quiz is shown under the generated title.
// The route's stream is the bare array the route answers (route.test.ts), in
// small chunks; the title action is the server action's stand-in.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ChatWithFiles from "@/app/(preview)/page";
import { SITE_NAME, SOURCE_URL } from "@/app/site";
import { makePdf, quizFrom } from "./fake-ai";

vi.mock("@/app/(preview)/actions", () => ({
  generateQuizTitle: vi.fn(async () => "Zephyr Pelicans"),
}));

const LINES = ["Pelicans cross Lake Orvel.", "Wings span three metres.", "Reeds feed the flock.", "Rangers count them."];

let release: () => void;
let requests: { url: string; body: { files: { name: string; type: string; data: string }[] } }[];

beforeEach(() => {
  requests = [];
  const gate = new Promise<void>((r) => (release = r));
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    const text = JSON.stringify(quizFrom(LINES.join("\n")));
    // Everything up to the end of the second question, then a pause until the
    // test releases the rest.
    const cut = text.indexOf("},{", text.indexOf("},{") + 1) + 2;
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(enc.encode(text.slice(0, cut)));
        await gate;
        controller.enqueue(enc.encode(text.slice(cut)));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8" } });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the page", () => {
  it("shows the site's name and links the product's own source", () => {
    render(<ChatWithFiles />);
    expect(screen.getByText(SITE_NAME)).toBeTruthy();
    expect(screen.getByText("Drop your PDF here or click to browse.")).toBeTruthy();
    const source = screen.getByText("View Source Code").closest("a")!;
    expect(source.getAttribute("href")).toBe(SOURCE_URL);
    expect(screen.getByText("Deploy your own").closest("a")!.getAttribute("href")).toBe(`${SOURCE_URL}#deploy-by-hand`);
    expect(screen.queryByText("Deploy with Vercel")).toBeNull();
  });

  it("refuses a file that is not a PDF", () => {
    render(<ChatWithFiles />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["hi"], "notes.txt", { type: "text/plain" })] } });
    expect((screen.getByRole("button", { name: "Generate Quiz" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("streams the quiz in, question by question, then shows it under its title", async () => {
    render(<ChatWithFiles />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File([makePdf(LINES)], "zephyr-pelicans.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(screen.getByText("zephyr-pelicans.pdf")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Generate Quiz" }));
    });
    // Two questions in, two to come: the template's progress line.
    expect(await screen.findByText("Generating question 3 of 4")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("/api/generate-quiz");
    const sent = requests[0]!.body.files[0]!;
    expect(sent.name).toBe("zephyr-pelicans.pdf");
    expect(sent.data.startsWith("data:application/pdf;base64,")).toBe(true);

    await act(async () => release());
    expect(await screen.findByText("Zephyr Pelicans")).toBeTruthy();
    expect(screen.getByText("Question 1: which line does the document contain?")).toBeTruthy();
    expect(screen.getByText(LINES[0]!)).toBeTruthy();
  });
});
