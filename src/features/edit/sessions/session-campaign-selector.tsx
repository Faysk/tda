"use client";

import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/features/edit/workbench.module.css";

type CampaignOption = Readonly<{
	technicalSlug: string;
	name: string;
}>;

export function SessionCampaignSelector({
	currentCampaignSlug,
	campaigns,
}: Readonly<{
	currentCampaignSlug: string;
	campaigns: readonly CampaignOption[];
}>) {
	const router = useRouter();
	const searchParams = useSearchParams();

	if (campaigns.length <= 1) return null;

	return (
		<label>
			<span>Campanha</span>
			<select
				aria-label="Campanha da biblioteca"
				className={styles.control}
				onChange={(event) => {
					const nextCampaign = event.target.value;
					if (!nextCampaign || nextCampaign === currentCampaignSlug) return;
					const next = new URLSearchParams(searchParams.toString());
					// Arc names are campaign-owned; carrying one across campaigns can
					// create a misleading empty result.
					next.delete("arco");
					const query = next.toString();
					router.push(
						"/edit/" +
							encodeURIComponent(nextCampaign) +
							"/sessoes" +
							(query ? "?" + query : ""),
					);
				}}
				value={currentCampaignSlug}
			>
				{campaigns.map((campaign) => (
					<option key={campaign.technicalSlug} value={campaign.technicalSlug}>
						{campaign.name}
					</option>
				))}
			</select>
		</label>
	);
}
