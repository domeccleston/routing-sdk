import { describe, it } from "vitest";

describe("company enrichment provider contract", () => {
  it.todo("returns normalized company facts for a domain");
  it.todo("returns not_found for a valid domain with no company");
  it.todo("returns unavailable with a typed reason when the provider fails");
});

describe("CRM ownership provider contract", () => {
  it.todo("returns an owner identity without embedding a booking URL");
  it.todo("distinguishes an unowned company from a missing company");
  it.todo("returns unavailable with a typed reason when the provider fails");
});
