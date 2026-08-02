import { describe, expect, it } from "vitest";
import { buildUpdaterManifest, WINDOWS_PLATFORM_KEY } from "./updater-manifest-lib.mjs";

describe("updater manifest contract", () => {
  it("uses the configured endpoint, Tauri Windows key, artifact URL, and signature", () => {
    const manifest = buildUpdaterManifest({
      version: "1.2.3",
      endpoint: "https://downloads.example.com/aigit/latest.json",
      artifactName: "aigit_1.2.3_x64-setup.nsis.zip",
      signature: "signed-content\n",
      pubDate: "2026-08-01T00:00:00.000Z",
    });

    expect(Object.keys(manifest.platforms)).toEqual([WINDOWS_PLATFORM_KEY]);
    expect(manifest.platforms[WINDOWS_PLATFORM_KEY]).toEqual({
      signature: "signed-content",
      url: "https://downloads.example.com/aigit/aigit_1.2.3_x64-setup.nsis.zip",
    });
  });

  it.each(["", "not-a-url", "http://downloads.example.com/latest.json"])(
    "rejects an invalid updater endpoint: %s",
    (endpoint) => expect(() => buildUpdaterManifest({
      version: "1.2.3",
      endpoint,
      artifactName: "aigit.nsis.zip",
      signature: "signature",
    })).toThrow(),
  );

  it("rejects missing signatures and non-updater artifacts", () => {
    expect(() => buildUpdaterManifest({ version: "1.2.3", endpoint: "https://example.com/latest.json", artifactName: "aigit.exe", signature: "signature" })).toThrow(/NSIS/);
    expect(() => buildUpdaterManifest({ version: "1.2.3", endpoint: "https://example.com/latest.json", artifactName: "aigit.nsis.zip", signature: " " })).toThrow(/signature/);
  });
});
