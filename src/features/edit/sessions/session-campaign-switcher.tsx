"use client";

import {
	CampaignRoutePicker,
	type CampaignRouteChoice,
} from "@/features/campaigns/campaign-picker";
import { campaignManagementHref } from "@/features/campaigns/entrypoints";

export type SessionCampaignSwitchOption = Readonly<{
	key: string;
	name: string;
	href: string;
	current: boolean;
	lifecycle: "active" | "archived";
}>;

export function SessionCampaignSwitcher({
	options,
	canManage = false,
	returnTo,
}: {
	options: readonly SessionCampaignSwitchOption[];
	canManage?: boolean;
	returnTo: string;
}) {
	const current = options.find((option) => option.current);
	const choices: readonly CampaignRouteChoice<string>[] = options.map((option) => ({
		value: option.key,
		label: option.name,
		href: option.href,
		lifecycle: option.lifecycle,
	}));

	return (
		<CampaignRoutePicker
			ariaLabel="Campanha da biblioteca"
			behavior="immediate"
			currentValue={current?.key}
			label="Campanha"
			manageAction={
				canManage
					? {
							label: "Gerir campanhas",
							href: campaignManagementHref(returnTo),
						}
					: undefined
			}
			options={choices}
		/>
	);
}
