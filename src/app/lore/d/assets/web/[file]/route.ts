import { type NextRequest, NextResponse } from "next/server";

const media = new Map([
  [
    "d-completo.png",
    "https://media.dnd.faysk.dev/lore/d/9d751c8d81fed971540e35a249c9804c434467004c9c21d858f24900adab77de/d-completo.png",
  ],
  [
    "d-sem-sobretudo.png",
    "https://media.dnd.faysk.dev/lore/d/69f12023e3e3deaa489ffab303bad555dde46218588e83697044a4c18753c2d5/d-sem-sobretudo.png",
  ],
  [
    "d-sem-chapeu.png",
    "https://media.dnd.faysk.dev/lore/d/28504455959c820eef86c93b260cdfb45ed1e75e37db40309477dc69acdba3e7/d-sem-chapeu.png",
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
