"use client";

import { CampaignRoutePicker } from "@/features/campaigns/campaign-route-picker";

export type SessionCampaignSwitchOption = Readonly<{
	key: string;
	name: string;
	href: string;
	current: boolean;
	lifecycle: "active" | "archived";
}>;

export function SessionCampaignSwitcher({
	options,
	className,
	manageHref,
}: {
	options: readonly SessionCampaignSwitchOption[];
	className?: string;
	manageHref?: string;
}) {
	const current = options.find((option) => option.current);

	return (
		<CampaignRoutePicker
			ariaLabel="Campanha da biblioteca"
			label="Campanha"
			selectClassName={className}
			value={current?.key ?? ""}
			options={options.map((option) => ({
				value: option.key,
				label: option.name,
				lifecycle: option.lifecycle,
				disabled: option.lifecycle === "archived",
				href: option.href,
			}))}
			canManage={Boolean(manageHref)}
			manageHref={manageHref}
			pendingLabel="Abrindo biblioteca…"
		/>
	);
}
