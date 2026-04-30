import { describe, it, expect } from "vitest";
import { splitFullName } from "@/domain/ingest/normalize";

describe("splitFullName", () => {
  it("handles a basic First Last", () => {
    expect(splitFullName("John Smith")).toEqual({
      first: "John",
      middle: null,
      last: "Smith",
      suffix: null,
    });
  });

  it("handles First Middle Last", () => {
    expect(splitFullName("John Q Smith")).toEqual({
      first: "John",
      middle: "Q",
      last: "Smith",
      suffix: null,
    });
  });

  it("handles a comma-form Last, First Middle Suffix", () => {
    expect(splitFullName("Smith, John Q Jr")).toEqual({
      first: "John",
      middle: "Q",
      last: "Smith",
      suffix: "Jr",
    });
  });

  it("handles First Last Suffix", () => {
    expect(splitFullName("John Smith III")).toEqual({
      first: "John",
      middle: null,
      last: "Smith",
      suffix: "III",
    });
  });

  it("collapses runs of whitespace", () => {
    expect(splitFullName("  John   Q   Smith  ")).toEqual({
      first: "John",
      middle: "Q",
      last: "Smith",
      suffix: null,
    });
  });

  it("returns all-null for empty input", () => {
    expect(splitFullName("")).toEqual({ first: null, middle: null, last: null, suffix: null });
    expect(splitFullName("   ")).toEqual({ first: null, middle: null, last: null, suffix: null });
  });

  it("treats a single word as first only", () => {
    expect(splitFullName("Cher")).toEqual({
      first: "Cher",
      middle: null,
      last: null,
      suffix: null,
    });
  });

  it("preserves a multi-word last name on the comma form", () => {
    expect(splitFullName("Van Der Berg, Hans")).toEqual({
      first: "Hans",
      middle: null,
      last: "Van Der Berg",
      suffix: null,
    });
  });

  it("strips suffix from comma form when present", () => {
    expect(splitFullName("Smith, John Sr.")).toEqual({
      first: "John",
      middle: null,
      last: "Smith",
      suffix: "Sr.",
    });
  });

  it("leaves a suffix-only restpart with no first name", () => {
    // "Smith, " => last=Smith, rest empty => first=null
    expect(splitFullName("Smith,")).toEqual({
      first: null,
      middle: null,
      last: "Smith",
      suffix: null,
    });
  });
});
