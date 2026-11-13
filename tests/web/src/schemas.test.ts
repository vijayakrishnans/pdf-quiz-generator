// lib/schemas.ts, the template's: four questions, four options each, one
// answer letter.
import { describe, expect, it } from "vitest";
import { questionSchema, questionsSchema } from "@/lib/schemas";

const q = (answer = "A") => ({ question: "Q?", options: ["a", "b", "c", "d"], answer });

describe("the quiz schema", () => {
  it("takes four questions of four options", () => {
    expect(questionsSchema.parse([q("A"), q("B"), q("C"), q("D")])).toHaveLength(4);
  });

  it("refuses three questions, three options, or an answer past D", () => {
    expect(questionsSchema.safeParse([q(), q(), q()]).success).toBe(false);
    expect(questionSchema.safeParse({ ...q(), options: ["a", "b", "c"] }).success).toBe(false);
    expect(questionSchema.safeParse(q("E")).success).toBe(false);
  });
});
