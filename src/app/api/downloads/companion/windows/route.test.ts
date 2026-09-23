import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const stableTag = "companion-v0.3.13";

function stableRefs() {
  return [
    {
      ref: `refs/tags/${stableTag}`,
      object: { type: "commit", sha: "a".repeat(40) },
    },
  ];
}

function stableRelease() {
  return {
    tag_name: stableTag,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "TDACompanion-x64.msi",
        browser_download_url:
          `https://github.com/Faysk/tda/releases/download/${stableTag}/TDACompanion-x64.msi`,
        digest: `sha256:${"a".repeat(64)}`,
        size: 84_000_000,
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Companion Windows download route", () => {
  it("ignores Vercel share transport metadata when resolving Stable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(stableRefs()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(stableRelease()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    );

    const response = await GET(
      new Request(
        "https://dnd.faysk.dev/api/downloads/companion/windows?_vercel_share=temporary-preview-token",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://github.com/Faysk/tda/releases/download/${stableTag}/TDACompanion-x64.msi`,
    );

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/git/matching-refs/tags/companion-v",
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      `/releases/tags/${stableTag}`,
    );
  });

  it("keeps unrelated unexpected query parameters fail-closed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        "https://dnd.faysk.dev/api/downloads/companion/windows?unexpected=1",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "COMPANION_RELEASE_REQUEST_INVALID",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an immutable tag together with Vercel share metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(stableRelease()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const response = await GET(
      new Request(
        `https://dnd.faysk.dev/api/downloads/companion/windows?tag=${stableTag}&_vercel_share=temporary-preview-token`,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      `/releases/download/${stableTag}/TDACompanion-x64.msi`,
    );
  });
});
