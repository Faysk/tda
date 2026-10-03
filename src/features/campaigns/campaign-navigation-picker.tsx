"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
	CampaignPicker,
	type CampaignPickerOption,
} from "./campaign-picker";

export type CampaignNavigationOption = CampaignPickerOption &
	Readonly<{ href: string }>;

export function CampaignNavigationPicker({
	value,
	options,
	ariaLabel,
	placeholderLabel = "Selecione…",
	className,
	selectClassName,
	canManage = false,
	manageHref = "/edit/campanhas",
	manageTarget = "_self",
	pendingLabel = "Abrindo campanha…",
}: Readonly<{
	value: string;
	options: readonly CampaignNavigationOption[];
	ariaLabel: string;
	placeholderLabel?: string;
	className?: string;
	selectClassName?: string;
	canManage?: boolean;
	manageHref?: string;
	manageTarget?: "_blank" | "_self";
	pendingLabel?: string;
}>) {
	const router = useRouter();
	const [selection, setSelection] = useState(value);
	const [pending, setPending] = useState(false);

	useEffect(() => {
		setSelection(value);
		setPending(false);
	}, [value]);

	function navigate(nextValue: string) {
		if (pending) return;
		const option = options.find((item) => item.value === nextValue);
		if (!option || option.disabled || nextValue === value) {
			setSelection(value);
			return;
		}
		setSelection(nextValue);
		setPending(true);
		router.push(option.href);
	}

	return (
		<CampaignPicker
			value={selection}
			options={options}
			onChange={navigate}
			ariaLabel={ariaLabel}
			placeholderLabel={placeholderLabel}
			className={className}
			selectClassName={selectClassName}
			pending={pending}
			pendingLabel={pendingLabel}
			canManage={canManage}
			manageHref={manageHref}
			manageTarget={manageTarget}
		/>
	);
}
