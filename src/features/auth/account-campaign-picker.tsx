"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CampaignPicker } from "@/features/campaigns/campaign-picker";
import type { AccountCampaignOption } from "./account-campaign-access";

export function AccountCampaignPicker({
	campaigns,
	selectedCampaignSlug,
	className,
}: Readonly<{
	campaigns: readonly AccountCampaignOption[];
	selectedCampaignSlug: string | null;
	className?: string;
}>) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	function selectCampaign(value: string) {
		const next = new URLSearchParams(searchParams.toString());
		if (value) next.set("campanha", value);
		else next.delete("campanha");
		router.push(next.size > 0 ? `${pathname}?${next.toString()}` : pathname);
	}

	return (
		<CampaignPicker
			value={selectedCampaignSlug ?? ""}
			options={campaigns.map((campaign) => ({
				value: campaign.technicalSlug,
				label: campaign.name,
			}))}
			onChange={selectCampaign}
			ariaLabel="Campanha consultada"
			optional
			generalValue=""
			generalLabel="Escolha uma campanha"
			className={className}
		/>
	);
}
