const MEDIA: Record<string, string> = {
  "wide-adult-seika-full.avif":
    "https://media.dnd.faysk.dev/lore/seika/f438b2f149ad7b187220861530234eb998853dc64d9869b3b84c1c3fb2f5f289/wide-adult-seika-full.webp",
  "wide-ami-ritual-full.avif":
    "https://media.dnd.faysk.dev/lore/seika/8ef2730e025f01bb6ae59dffdcfad1994a4835cd4e43d574cd35e1c02fda0b16/wide-ami-ritual-full.webp",
  "wide-departure-full.avif":
    "https://media.dnd.faysk.dev/lore/seika/74cf3cdab85ed37eac4a28276864449b9101716e63202ae32a9c314e299793b5/wide-departure-full.webp",
  "wide-first-exorcism-full.avif":
    "https://media.dnd.faysk.dev/lore/seika/386ead888a202639588f00b1f07bceebbe83f60f2423963d87f74d9956e530d9/wide-first-exorcism-full.webp",
  "wide-ink-moon.avif":
    "https://media.dnd.faysk.dev/lore/seika/2e223c08e8b273dec7a27e114a37e89f3039f108f64787ab1a17d3df4acdccc6/wide-ink-moon.webp",
  "wide-lucky-full.avif":
    "https://media.dnd.faysk.dev/lore/seika/a02d6f1ccc772a78f130113b2a7edda88bd0dfbb422be651a75390f8cbcfc7ad/wide-lucky-full.webp",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  const target = MEDIA[file];

  if (!target) {
    return new Response("Not found", { status: 404 });
  }

  return Response.redirect(target, 307);
}
