export const dynamic = "force-static";

const BODY = `/* Seika pack-fidelity fixes — preserve the approved ZIP layout. */
.daily{
  min-height:auto;
  display:block;
}
.story-frame-right{
  position:relative;
  z-index:2;
  background:linear-gradient(-90deg,rgba(24,17,12,.68),rgba(24,17,12,.22));
}
.npc-weave{
  position:relative;
  left:auto;
  right:auto;
  bottom:auto;
  z-index:1;
  width:92vw;
  margin:5rem auto 0;
}
@media (max-width:1100px){
  .npc-weave{grid-template-columns:repeat(3,1fr);margin:5rem auto 0}
  .story-frame-right{margin-left:auto}
}
@media (max-width:800px){
  .daily{min-height:auto;padding:5rem 0}
  .story-frame-right{margin:0 1rem 0 auto;width:calc(100% - 2rem)}
  .npc-weave{grid-template-columns:1fr 1fr;margin:4rem auto 0}
  .npc-card{min-height:165px}
}
@media (max-width:520px){
  .npc-weave{grid-template-columns:1fr}
  .npc-photo{height:105px}
}
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
