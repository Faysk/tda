import part1 from "../_content/script-1";
import part2 from "../_content/script-2";
import part3 from "../_content/script-3";
import part4 from "../_content/script-4";

export const dynamic = "force-static";

const BODY = [part1, part2, part3, part4].join("");

export function GET() {
  return new Response(BODY, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
