import { describe, it, expect } from "vitest";
import { questionLikelyMentionsName } from "@/domain/voterSearch";

describe("questionLikelyMentionsName", () => {
  it("flags surname-style queries", () => {
    expect(questionLikelyMentionsName("the dasgupta family")).toBe(true);
    expect(questionLikelyMentionsName("any Smiths in Tenafly")).toBe(true);
    expect(questionLikelyMentionsName("find Pinaki")).toBe(true);
    expect(questionLikelyMentionsName("Hernandez")).toBe(true);
  });

  it("ignores generic analytic questions", () => {
    expect(questionLikelyMentionsName("what issues come up most?")).toBe(false);
    expect(questionLikelyMentionsName("show me supporters")).toBe(false);
    expect(questionLikelyMentionsName("how many talks this week")).toBe(false);
    expect(questionLikelyMentionsName("list undecided voters")).toBe(false);
  });

  it("handles edge cases without crashing", () => {
    expect(questionLikelyMentionsName("")).toBe(false);
    expect(questionLikelyMentionsName("...")).toBe(false);
    expect(questionLikelyMentionsName("a b c")).toBe(false); // all <3 letters
  });

  it("treats long unknown words as plausibly names", () => {
    // "alvarez" is not in the stopword list and is 7 chars — assume name
    expect(questionLikelyMentionsName("alvarez")).toBe(true);
  });

  it("does not trigger on stopword-only sentences even if capitalized", () => {
    // "The" / "Show" / "Who" are all stopwords; ALL CAPS doesn't bypass
    expect(questionLikelyMentionsName("Show Me Who")).toBe(false);
  });
});
