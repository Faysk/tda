"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
	CampaignPicker,
	type CampaignPickerOption,
} from "@/features/campaigns/campaign-picker";

export function AccountCampaignPicker({
	value,
	options,
}: Readonly<{
	value: string;
	options: readonly CampaignPickerOption[];
}>) {
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [pending, startTransition] = useTransition();

	return (
		<CampaignPicker
			value={value}
			options={options}
			ariaLabel="Campanha consultada"
			disabled={pending}
			onChange={(nextValue) => {
				const params = new URLSearchParams(searchParams.toString());
				if (nextValue) params.set("campanha", nextValue);
				else params.delete("campanha");
				const query = params.toString();
				startTransition(() => {
					router.replace(query ? `${pathname}?${query}` : pathname, {
						scroll: false,
					});
				});
			}}
		/>
	);
}
