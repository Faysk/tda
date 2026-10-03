import { notFound } from "next/navigation";
import { CampaignPickerFixtureClient } from "./fixture-client";

export const dynamic = "force-dynamic";

type Props = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export default async function CampaignPickerFixture({ searchParams }: Props) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const params = await searchParams;
	return (
		<CampaignPickerFixtureClient
			mode={first(params.mode) === "confirmed" ? "confirmed" : "immediate"}
			scenario={first(params.scenario) ?? "many"}
			selected={first(params.selected) ?? ""}
			canManage={first(params.manage) !== "0"}
		/>
	);
}
