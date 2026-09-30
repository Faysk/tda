import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function RouteLoadingFixtureIndex() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();

	return (
		<section>
			<h1>Route Loading E2E</h1>
			<nav aria-label="Loading families">
				<Link href="/e2e-fixtures/route-loading/cinematic" prefetch={false}>
					Cinematic lenta
				</Link>
				<Link href="/e2e-fixtures/route-loading/editorial" prefetch={false}>
					Editorial lenta
				</Link>
				<Link href="/e2e-fixtures/route-loading/workspace" prefetch={false}>
					Workspace lenta
				</Link>
				<Link href="/e2e-fixtures/route-loading/world" prefetch={false}>
					World lento
				</Link>
				<Link href="/e2e-fixtures/route-loading/compact" prefetch={false}>
					Compact lento
				</Link>
			</nav>
		</section>
	);
}
