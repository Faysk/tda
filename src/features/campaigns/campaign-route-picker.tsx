"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
	CampaignPicker,
	type CampaignPickerOption,
} from "./campaign-picker";
import styles from "./campaign-picker.module.css";

export type CampaignRoutePickerOption = CampaignPickerOption &
	Readonly<{ href: string }>;

export type CampaignRoutePickerProps = Readonly<{
	value: string;
	options: readonly CampaignRoutePickerOption[];
	ariaLabel: string;
	label?: string;
	behavior?: "immediate" | "confirmed";
	optional?: boolean;
	generalValue?: string;
	generalLabel?: string;
	confirmLabel?: string;
	pendingLabel?: string;
	className?: string;
	selectClassName?: string;
	canManage?: boolean;
	manageHref?: string;
}>;

export function CampaignRoutePicker({
	value,
	options,
	ariaLabel,
	label = "Campanha",
	behavior = "immediate",
	optional = false,
	generalValue = "",
	generalLabel = "Geral",
	confirmLabel = "Abrir campanha",
	pendingLabel = "Abrindo campanha…",
	className,
	selectClassName,
	canManage = false,
	manageHref,
}: CampaignRoutePickerProps) {
	const router = useRouter();
	const [selection, setSelection] = useState(value);
	const [pending, startTransition] = useTransition();

	useEffect(() => {
		setSelection(value);
	}, [value]);

	const selected = options.find((option) => option.value === selection);
	const changed = selection !== value;
	const canNavigate = Boolean(selected && !selected.disabled && selected.href);

	function select(next: string) {
		setSelection(next);
		if (behavior !== "immediate" || next === value) return;
		const destination = options.find((option) => option.value === next);
		if (!destination || destination.disabled) return;
		startTransition(() => router.push(destination.href));
	}

	function confirm() {
		if (!selected || selected.disabled) return;
		startTransition(() => router.push(selected.href));
	}

	const status =
		behavior === "confirmed" && changed
			? "Seleção alterada. Confirme para abrir este contexto."
			: value
				? "Campanha aplicada ao contexto atual."
				: "";

	return (
		<div className={styles.route}>
			<span className={styles.routeLabel}>{label}</span>
			<div className={styles.routeRow}>
				<CampaignPicker
					value={selection}
					options={options}
					onChange={select}
					ariaLabel={ariaLabel}
					optional={optional}
					generalValue={generalValue}
					generalLabel={generalLabel}
					disabled={pending}
					className={className}
					selectClassName={selectClassName}
					canManage={canManage}
					manageHref={manageHref}
				/>
				{behavior === "confirmed" ? (
					<button
						type="button"
						className={styles.confirm}
						disabled={pending || !canNavigate || (!changed && Boolean(value))}
						onClick={confirm}
					>
						{pending ? pendingLabel : confirmLabel}
					</button>
				) : null}
			</div>
			<p className={styles.routeStatus} role="status" aria-live="polite">
				{pending ? pendingLabel : status}
			</p>
		</div>
	);
}
