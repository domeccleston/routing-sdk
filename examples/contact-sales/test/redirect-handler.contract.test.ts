import { describe, it } from "vitest";

describe("redirect handler contract", () => {
  it.todo("accepts an HTML form POST and returns a 303 redirect");
  it.todo("redirects routed submissions to the selected Cal.com URL");
  it.todo("redirects non-routed submissions to the configured fallback URL");
  it.todo("does not expose enrichment or CRM data in the redirect URL");
  it.todo("persists the decision before returning the redirect");
  it.todo("fails open when decision persistence is unavailable");
});
