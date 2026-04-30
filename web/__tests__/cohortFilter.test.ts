import { describe, it, expect } from "vitest";
import { CohortFilter } from "@/domain/ai/cohortBuilder";

describe("CohortFilter zod schema", () => {
  it("accepts a fully populated filter", () => {
    const parsed = CohortFilter.parse({
      age_min: 30,
      age_max: 60,
      party: "DEM",
      city: "Tenafly",
      zip: "07670",
      precinct: "Ward 2",
      municipality: "Tenafly",
      state: "NJ",
      voter_status: "ACTIVE",
      voted_in: "PRIMARY",
      voted_party: "DEM",
      voted_after: "2022-01-01",
      voted_before: "2024-12-31",
      min_total_votes: 3,
      min_relevant_votes: 2,
    });
    expect(parsed.age_min).toBe(30);
    expect(parsed.party).toBe("DEM");
  });

  it("accepts the all-empty default the model returns when nothing is specified", () => {
    const parsed = CohortFilter.parse({
      age_min: null,
      age_max: null,
      party: "",
      city: "",
      zip: "",
      precinct: "",
      municipality: "",
      state: "",
      voter_status: "",
      voted_in: "",
      voted_party: "",
      voted_after: "",
      voted_before: "",
      min_total_votes: null,
      min_relevant_votes: null,
    });
    expect(parsed.age_min).toBeNull();
    expect(parsed.party).toBe("");
  });

  it("rejects an unknown party code", () => {
    expect(() =>
      CohortFilter.parse({
        age_min: null,
        age_max: null,
        party: "MAGA", // not in enum
        city: "",
        zip: "",
        precinct: "",
        municipality: "",
        state: "",
        voter_status: "",
        voted_in: "",
        voted_party: "",
        voted_after: "",
        voted_before: "",
        min_total_votes: null,
        min_relevant_votes: null,
      }),
    ).toThrow();
  });

  it("rejects a non-integer age", () => {
    expect(() =>
      CohortFilter.parse({
        age_min: 30.5,
        age_max: null,
        party: "",
        city: "",
        zip: "",
        precinct: "",
        municipality: "",
        state: "",
        voter_status: "",
        voted_in: "",
        voted_party: "",
        voted_after: "",
        voted_before: "",
        min_total_votes: null,
        min_relevant_votes: null,
      }),
    ).toThrow();
  });
});
