import { describe, expect, it } from "vitest";

import { createSaveFingerprint, saveEventMatchesContent } from "../utils/save-state";

describe("save-state fingerprinting", () => {
  it("matches identical content using the persisted fingerprint", () => {
    const content = "\\section{Intro}\nCafé ∑";
    const fingerprint = createSaveFingerprint(content);

    expect(fingerprint).toEqual({
      contentHash: "97c37c53",
      contentLength: 25,
    });
    expect(
      saveEventMatchesContent(content, {
        content_hash: fingerprint.contentHash,
        content_length: fingerprint.contentLength,
      }),
    ).toBe(true);
  });

  it("rejects stale persisted fingerprints", () => {
    const fingerprint = createSaveFingerprint("Hello world");

    expect(
      saveEventMatchesContent("Hello world!", {
        content_hash: fingerprint.contentHash,
        content_length: fingerprint.contentLength,
      }),
    ).toBe(false);
  });
});
