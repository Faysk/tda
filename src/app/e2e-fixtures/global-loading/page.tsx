import { notFound } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";

export const dynamic = "force-dynamic";

export default function GlobalLoadingE2EFixture() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();

	return (
		<main>
			<h1>Global Loading E2E</h1>
			<Link href="/e2e-fixtures/global-loading/slow">Abrir rota lenta</Link>
		</main>
	);
}
