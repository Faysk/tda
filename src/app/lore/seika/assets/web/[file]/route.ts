import loreMedia from "@/config/published-lore-media.json";

type SeikaMedia = {
  url: string;
  mime: "image/webp";
  sha256: string;
};

const CANONICAL_MEDIA = loreMedia.seika as Record<string, SeikaMedia>;

// Current Seika markup still references historical .avif aliases. Keep those
// aliases compatible, but return the truthful WebP MIME and actual bytes.
const MEDIA: Record<string, SeikaMedia> = Object.fromEntries([
  ...Object.entries(CANONICAL_MEDIA),
  ...Object.entries(CANONICAL_MEDIA).map(([file, media]) => [
    file.replace(/\.webp$/, ".avif"),
    media,
  ]),
]);

export const revalidate = 86400;

function failure(message: string, status = 502) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  const media = MEDIA[file];
  if (!media) return failure("Not found", 404);

  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(media.url, {
      headers: range ? { Range: range } : undefined,
      ...(range ? { cache: "no-store" as const } : { next: { revalidate: 86400 } }),
    });
  } catch (error) {
    console.error("Seika media upstream request failed", { file, error });
    return failure("Media upstream unavailable");
  }

  if (!upstream.ok && upstream.status !== 206) {
    console.error("Seika media upstream returned an error", {
      file,
      status: upstream.status,
    });
    return failure(`Media upstream returned ${upstream.status}`);
  }

  const upstreamMime = upstream.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (upstreamMime !== media.mime) {
    console.error("Seika media MIME mismatch", {
      file,
      expected: media.mime,
      actual: upstreamMime,
    });
    return failure("Media upstream MIME mismatch");
  }

  const headers = new Headers({
    "Content-Type": media.mime,
    "Cache-Control":
      "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    "X-Content-Type-Options": "nosniff",
    "X-TDA-Media-SHA256": media.sha256,
  });

  for (const name of [
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
