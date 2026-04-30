import { describe, it, expect } from "vitest";
import { normalizeDate } from "@/domain/ingest/normalize";

describe("normalizeDate", () => {
  it("passes through ISO YYYY-MM-DD", () => {
    expect(normalizeDate("2026-04-27")).toBe("2026-04-27");
  });

  it("parses ISO with time component", () => {
    expect(normalizeDate("2026-04-27T10:30:00")).toBe("2026-04-27");
  });

  it("parses YYYY/MM/DD", () => {
    expect(normalizeDate("2026/04/27")).toBe("2026-04-27");
  });

  it("parses MM/DD/YYYY", () => {
    expect(normalizeDate("04/27/2026")).toBe("2026-04-27");
  });

  it("parses M/D/YYYY without leading zeros", () => {
    expect(normalizeDate("4/7/2026")).toBe("2026-04-07");
  });

  it("expands M/D/YY to 20YY", () => {
    expect(normalizeDate("4/7/26")).toBe("2026-04-07");
  });

  it("parses YYYYMMDD", () => {
    expect(normalizeDate("20260427")).toBe("2026-04-27");
  });

  it("parses 'January 5, 2020'", () => {
    expect(normalizeDate("January 5, 2020")).toBe("2020-01-05");
  });

  it("parses 'Jan 5 2020' with no comma", () => {
    expect(normalizeDate("Jan 5 2020")).toBe("2020-01-05");
  });

  it("parses '5-Jan-2020'", () => {
    expect(normalizeDate("5-Jan-2020")).toBe("2020-01-05");
  });

  it("returns null on garbage", () => {
    expect(normalizeDate("not a date")).toBeNull();
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("  ")).toBeNull();
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
  });

  it("returns null on partial / ambiguous formats", () => {
    expect(normalizeDate("2026-04")).toBeNull(); // missing day
    expect(normalizeDate("4/2026")).toBeNull();
    expect(normalizeDate("April 2020")).toBeNull(); // no day
  });
});
