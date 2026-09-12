import { type NextRequest, NextResponse } from "next/server";

const media = new Map([
  [
    "d-completo.png",
    "https://media.dnd.faysk.dev/lore/d/30f853af30136239f0559cfe6e300949f6be1c0667cd4bd866e8c458eff01052/d-completo.png",
  ],
  [
    "d-sem-sobretudo.png",
    "https://media.dnd.faysk.dev/lore/d/726b86485d7488163545701a338c5b228273cbfc400bb7c7b72d96ae092d65c9/d-sem-sobretudo.png",
  ],
  [
    "d-sem-chapeu.png",
    "https://media.dnd.faysk.dev/lore/d/bdeeafe50820939245bf39fcd5c79e685fc6bffa4593d18c3d15f0ade6c7042d/d-sem-chapeu.png",
  ],
]);

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  const target = media.get(file);

  if (!target) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: target,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
