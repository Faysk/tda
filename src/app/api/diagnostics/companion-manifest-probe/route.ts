export const dynamic = "force-dynamic";
export const revalidate = 0;

const TARGETS = [
	["default", "https://dnd.faysk.dev/api/downloads/companion/windows/manifest"],
	["stable", "https://dnd.faysk.dev/api/downloads/companion/windows/manifest?channel=stable"],
	["rc", "https://dnd.faysk.dev/api/downloads/companion/windows/manifest?channel=rc"],
] as const;

export async function GET() {
	const results = await Promise.all(
		TARGETS.map(async ([name, url]) => {
			const response = await fetch(url, {
				cache: "no-store",
				headers: { "User-Agent": "TDA-Manifest-Probe/1" },
			});
			return {
				name,
				status: response.status,
				body: await response.text(),
			};
		}),
	);
	return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
