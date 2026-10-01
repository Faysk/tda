import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function runtimeRelease(version: string) {
  const tag = `companion-whisper-runtime-v${version}`;
  const name = `TDAWhisperRuntime-${version}-windows-x64.zip`;
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: [
      {
        name,
        browser_download_url:
          `https://github.com/Faysk/tda/releases/download/${tag}/${name}`,
        digest: `sha256:${"a".repeat(64)}`,
        size: 1_234_567,
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Whisper runtime Stable manifest", () => {
  it("resolves an exact published Stable version without consulting latest tags", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(runtimeRelease("1.1.5")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        "https://dnd.faysk.dev/api/downloads/companion/windows/whisper-runtime/manifest?version=1.1.5",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      channel: "stable",
      runtime_id: "whisper-ctranslate2",
      version: "1.1.5",
      tag: "companion-whisper-runtime-v1.1.5",
      asset: {
        url: "/api/downloads/companion/windows/whisper-runtime?version=1.1.5",
        sha256: "a".repeat(64),
        size: 1_234_567,
      },
    });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/releases/tags/companion-whisper-runtime-v1.1.5",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("keeps latest Stable discovery when no version is requested", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              ref: "refs/tags/companion-whisper-runtime-v1.1.5",
              object: { type: "commit", sha: "1".repeat(40) },
            },
            {
              ref: "refs/tags/companion-whisper-runtime-v1.1.8",
              object: { type: "commit", sha: "2".repeat(40) },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(runtimeRelease("1.1.8")), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        "https://dnd.faysk.dev/api/downloads/companion/windows/whisper-runtime/manifest",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      version: "1.1.8",
      tag: "companion-whisper-runtime-v1.1.8",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ cache: "no-store" });
      expect(init).not.toHaveProperty("next");
    }
  });

  it.each([
    "?version=banana",
    "?version=1.1.5&version=1.1.6",
    "?version=1.1.5&unexpected=1",
    "?unexpected=1",
  ])("rejects invalid exact-version query %s before GitHub lookup", async (query) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        `https://dnd.faysk.dev/api/downloads/companion/windows/whisper-runtime/manifest${query}`,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "WHISPER_RUNTIME_RELEASE_REQUEST_INVALID",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns typed not-found for an exact Stable version that was never published", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        "https://dnd.faysk.dev/api/downloads/companion/windows/whisper-runtime/manifest?version=9.9.9",
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "WHISPER_RUNTIME_RELEASE_NOT_FOUND",
    });
  });
});
