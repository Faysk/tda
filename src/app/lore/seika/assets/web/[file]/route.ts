type SeikaMedia = {
  url: string;
  mime: "image/webp";
};

const MEDIA: Record<string, SeikaMedia> = {
  "wide-adult-seika-full.avif": {
    url: "https://media.dnd.faysk.dev/lore/seika/f438b2f149ad7b187220861530234eb998853dc64d9869b3b84c1c3fb2f5f289/wide-adult-seika-full.webp",
    mime: "image/webp",
  },
  "wide-ami-ritual-full.avif": {
    url: "https://media.dnd.faysk.dev/lore/seika/8ef2730e025f01bb6ae59dffdcfad1994a4835cd4e43d574cd35e1c02fda0b16/wide-ami-ritual-full.webp",
    mime: "image/webp",
  },
  "wide-departure-full.avif": {
    url: "https://media.dnd.faysk.dev/lore/seika/74cf3cdab85ed37eac4a28276864449b9101716e63202ae32a9c314e299793b5/wide-departure-full.webp",
    mime: "image/webp",
  },
  "wide-first-exorcism-full.avif": {
    url: "https://media.dnd.faysk.dev/lore/seika/386ead888a202639588f00b1f07bceebbe83f60f2423963d87f74d9956e530d9/wide-first-exorcism-full.webp",
    mime: "image/webp",
  },
  "wide-ink-moon.avif": {
    url: "https://media.dnd.faysk.dev/lore/seika/2e223c08e8b273dec7a27e114a37e89f3039f108f64787ab1a17d3df4acdccc6/wide-ink-moon.webp",
    mime: "image/webp",
  },
  "wide-lucky-full.avif": {
    url: "https://media.dnd.faysk.dev/lore/seika/a02d6f1ccc772a78f130113b2a7edda88bd0dfbb422be651a75390f8cbcfc7ad/wide-lucky-full.webp",
    mime: "image/webp",
  },
};

export const revalidate = 86400;

function failure(message: string, status = 502) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
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

  const upstreamMime = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
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
    "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    "X-Content-Type-Options": "nosniff",
  });

  for (const name of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
