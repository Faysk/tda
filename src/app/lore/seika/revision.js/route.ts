import part1 from "../_content/revision-js-1";
import part2 from "../_content/revision-js-2";
import part3 from "../_content/revision-js-3";
import part4 from "../_content/revision-js-4";
import part5 from "../_content/revision-js-5";

export const dynamic = "force-static";

const BODY = [part1, part2, part3, part4, part5].join("");

export function GET() {
  return new Response(BODY, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
