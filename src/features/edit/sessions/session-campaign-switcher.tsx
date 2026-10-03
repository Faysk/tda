"use client";

import { CampaignNavigationPicker } from "@/features/campaigns/campaign-navigation-picker";

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
	canManage = false,
	manageHref = "/edit/campanhas",
}: {
	options: readonly SessionCampaignSwitchOption[];
	className?: string;
	canManage?: boolean;
	manageHref?: string;
}) {
	const current = options.find((option) => option.current);

	return (
		<div className={className}>
			<span>Campanha</span>
			<CampaignNavigationPicker
				value={current?.key ?? ""}
				options={options.map((option) => ({
					value: option.key,
					label: option.name,
					disambiguation: option.key,
					href: option.href,
					lifecycle: option.lifecycle,
					disabled: false,
				}))}
				ariaLabel="Campanha da biblioteca"
				canManage={canManage}
				manageHref={manageHref}
				manageTarget="_self"
				pendingLabel="Abrindo biblioteca…"
			/>
		</div>
	);
}
