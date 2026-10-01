"use client";

import { useRouter } from "next/navigation";

export type SessionCampaignSwitchOption = Readonly<{
	key: string;
	name: string;
	href: string;
	current: boolean;
}>;

export function SessionCampaignSwitcher({
	options,
	className,
}: {
	options: readonly SessionCampaignSwitchOption[];
	className?: string;
}) {
	const router = useRouter();
	const current = options.find((option) => option.current);

	return (
		<label>
			<span>Campanha</span>
			<select
				aria-label="Campanha da biblioteca"
				className={className}
				value={current?.key ?? ""}
				onChange={(event) => {
					const selected = options.find(
						(option) => option.key === event.currentTarget.value,
					);
					if (selected && !selected.current) router.push(selected.href);
				}}
			>
				{options.map((option) => (
					<option key={option.key} value={option.key}>
						{option.name}
					</option>
				))}
			</select>
		</label>
	);
}
