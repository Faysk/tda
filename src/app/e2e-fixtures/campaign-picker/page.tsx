import { notFound } from "next/navigation";
import { CampaignPickerFixture } from "./picker-fixture";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
	current?: string | string[];
	mode?: string | string[];
	delay?: string | string[];
}>;

function first(value: string | string[] | undefined): string {
	return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function CampaignPickerE2EFixture({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const params = await searchParams;
	const rawCurrent = first(params.current);
	const current =
		rawCurrent === "alpha" || rawCurrent === "beta" ? rawCurrent : undefined;
	const mode = first(params.mode) === "immediate" ? "immediate" : "confirm";

	if (first(params.delay) === "1") {
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
	}

	return <CampaignPickerFixture current={current} mode={mode} />;
}
