import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
const ROUTE_DELAY_MS = 900;

export default async function RouteLoadingTarget() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	await new Promise((resolveDelay) => setTimeout(resolveDelay, ROUTE_DELAY_MS));

	return (
		<section>
			<h1>Editorial Loading E2E Target</h1>
		</section>
	);
}
