import { describe, it, expect } from "vitest";
import { stableNcid } from "@/domain/ingest/normalize";

describe("stableNcid", () => {
  const baseHashInput = {
    rawId: null,
    state: "NJ",
    first: "Pinaki",
    last: "Dasgupta",
    address: "123 Main St",
    city: "Tenafly",
    listId: "abcd1234-aaaa-bbbb-cccc-deadbeef0001",
    idx: 0,
  };

  it("namespaces a real raw ID by state", () => {
    expect(
      stableNcid({ ...baseHashInput, rawId: "12345" }),
    ).toBe("NJ:12345");
  });

  it("returns the raw ID unchanged when no state given", () => {
    expect(
      stableNcid({ ...baseHashInput, state: null, rawId: "BB12345" }),
    ).toBe("BB12345");
  });

  it("hashes identity when no raw ID — same inputs yield same id", () => {
    const a = stableNcid(baseHashInput);
    const b = stableNcid(baseHashInput);
    expect(a).toBe(b);
    expect(a.startsWith("H:NJ:")).toBe(true);
  });

  it("hash changes when state changes", () => {
    const a = stableNcid(baseHashInput);
    const b = stableNcid({ ...baseHashInput, state: "NC" });
    expect(a).not.toBe(b);
  });

  it("hash changes when name changes", () => {
    const a = stableNcid(baseHashInput);
    const b = stableNcid({ ...baseHashInput, first: "Anjali" });
    expect(a).not.toBe(b);
  });

  it("hash is case- and whitespace-insensitive", () => {
    const a = stableNcid(baseHashInput);
    const b = stableNcid({
      ...baseHashInput,
      first: "  PINAKI  ",
      last: "DASGUPTA",
      city: "  tenafly  ",
    });
    expect(a).toBe(b);
  });

  it("falls back to listId+idx when there's not enough signal to hash", () => {
    expect(
      stableNcid({
        ...baseHashInput,
        rawId: null,
        first: null,
        last: null,
        address: null,
        city: null,
        listId: "abcd1234-aaaa-bbbb-cccc-deadbeef0001",
        idx: 7,
      }),
    ).toBe("abcd1234-8");
  });

  it("non-state hash has the H: prefix without a state code", () => {
    const id = stableNcid({ ...baseHashInput, state: null });
    expect(id.startsWith("H:")).toBe(true);
    expect(id.startsWith("H:NJ:")).toBe(false);
  });
});
