"use client";

import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/features/edit/workbench.module.css";

type CampaignOption = Readonly<{
	technicalSlug: string;
	name: string;
	lifecycle: "active" | "archived";
}>;

export function SessionCampaignSwitcher({
	campaigns,
	currentCampaignSlug,
}: Readonly<{
	campaigns: readonly CampaignOption[];
	currentCampaignSlug: string;
}>) {
	const router = useRouter();
	const searchParams = useSearchParams();

	return (
		<label>
			<span>Campanha</span>
			<select
				aria-label="Campanha da biblioteca"
				className={styles.control}
				value={currentCampaignSlug}
				onChange={(event) => {
					const query = searchParams.toString();
					const href =
						`/edit/${encodeURIComponent(event.target.value)}/sessoes` +
						(query ? `?${query}` : "");
					router.push(href);
				}}
			>
				{campaigns.map((campaign) => (
					<option
						key={campaign.technicalSlug}
						value={campaign.technicalSlug}
					>
						{campaign.name}
						{campaign.lifecycle === "archived" ? " · arquivada" : ""}
					</option>
				))}
			</select>
		</label>
	);
}
