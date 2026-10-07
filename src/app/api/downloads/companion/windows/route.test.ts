import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const stableTag = "companion-v0.3.13";
const installer = new Uint8Array([77, 83, 73, 1]);
const installerSha = createHash("sha256").update(installer).digest("hex");

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
        digest: `sha256:${installerSha}`,
        size: installer.byteLength,
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
        )
        .mockResolvedValueOnce(new Response(installer)),
    );

    const response = await GET(
      new Request(
        "https://dnd.faysk.dev/api/downloads/companion/windows?_vercel_share=temporary-preview-token",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-disposition")).toContain("TDACompanion-x64.msi");
    expect(response.headers.get("content-length")).toBe(String(installer.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(installer);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify(stableRelease()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ).mockResolvedValueOnce(new Response(installer)),
    );

    const response = await GET(
      new Request(
        `https://dnd.faysk.dev/api/downloads/companion/windows?tag=${stableTag}&_vercel_share=temporary-preview-token`,
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(installer);
  });

  it("supports the Companion size probe when the upstream omits length", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(stableRelease()))
      .mockResolvedValueOnce(new Response(installer)));
    const response = await GET(new Request(
      `https://dnd.faysk.dev/api/downloads/companion/windows?tag=${stableTag}`,
      { headers: { Range: "bytes=0-0" } },
    ));
    // A server may ignore Range and return 200, but must advertise the full size.
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(installer.byteLength));
    expect(response.headers.get("x-tda-asset-sha256")).toBe(installerSha);
    expect(response.headers.get("location")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(installer);
  });

  it.each([new Uint8Array([1, 2, 3, 4]), new Uint8Array([77])])(
    "fails the download stream when upstream bytes are corrupt or truncated",
    async (bytes) => {
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce(Response.json(stableRelease()))
        .mockResolvedValueOnce(new Response(bytes)));
      const response = await GET(new Request(`https://dnd.faysk.dev/api/downloads/companion/windows?tag=${stableTag}`));
      await expect(response.arrayBuffer()).rejects.toThrow("COMPANION_ASSET_INTEGRITY_MISMATCH");
    },
  );

  it("returns a recoverable failure before streaming an upstream error", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(stableRelease()))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 })));
    const response = await GET(new Request(`https://dnd.faysk.dev/api/downloads/companion/windows?tag=${stableTag}`));
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });
});
