"use client";

import type { Ref } from "react";
import { Select, type SelectOption } from "@/components/ui";
import styles from "./campaign-picker.module.css";

export type CampaignPickerOption = Readonly<{
	value: string;
	label: string;
	lifecycle?: "active" | "archived";
	disabled?: boolean;
}>;

type CampaignPickerProps = Readonly<{
	value: string;
	options: readonly CampaignPickerOption[];
	onChange: (value: string) => void;
	ariaLabel: string;
	optional?: boolean;
	generalValue?: string;
	generalLabel?: string;
	disabled?: boolean;
	className?: string;
	selectClassName?: string;
	canManage?: boolean;
	canCreate?: boolean;
	onCreate?: () => void;
	createButtonRef?: Ref<HTMLButtonElement>;
	manageHref?: string;
}>;

export function CampaignPicker({
	value,
	options,
	onChange,
	ariaLabel,
	optional = false,
	generalValue = "",
	generalLabel = "Geral",
	disabled = false,
	className,
	selectClassName,
	canManage = false,
	canCreate = false,
	onCreate,
	createButtonRef,
	manageHref = "/edit/campanhas",
}: CampaignPickerProps) {
	const selectOptions: readonly SelectOption<string>[] = [
		...(optional ? [{ value: generalValue, label: generalLabel }] : []),
		...options.map((option) => ({
			value: option.value,
			label:
				option.lifecycle === "archived"
					? `${option.label} · arquivada`
					: option.label,
			disabled: option.disabled ?? option.lifecycle === "archived",
		})),
	];

	return (
		<div className={className ? `${styles.root} ${className}` : styles.root}>
			<Select
				value={value}
				options={selectOptions}
				onChange={onChange}
				ariaLabel={ariaLabel}
				className={selectClassName}
				disabled={disabled}
			/>
			{(canCreate && onCreate) || canManage ? (
				<div className={styles.actions}>
					{canCreate && onCreate ? (
						<button
							ref={createButtonRef}
							type="button"
							className={styles.action}
							onClick={onCreate}
							disabled={disabled}
						>
							Nova campanha
						</button>
					) : null}
					{canManage ? (
						<a
							className={styles.action}
							href={manageHref}
							target="_blank"
							rel="noreferrer"
							aria-label="Gerenciar campanhas (abre em nova aba)"
						>
							Gerenciar campanhas
							<span className={styles.external} aria-hidden="true">
								↗
							</span>
						</a>
					) : null}
				</div>
			) : null}
		</div>
	);
}
