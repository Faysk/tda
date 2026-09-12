import part1 from "../_content/backstory-1";
import part2 from "../_content/backstory-2";
import part3 from "../_content/backstory-3";
import part4a from "../_content/backstory-4a";
import part4b from "../_content/backstory-4b";
import part5 from "../_content/backstory-5";

export const dynamic = "force-static";

const BODY = [part1, part2, part3, part4a, part4b, part5].join("");

export function GET() {
  return new Response(BODY, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
