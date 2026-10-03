"use client";

import type { Ref } from "react";
import { Select, type SelectOption } from "@/components/ui";
import styles from "./campaign-picker.module.css";

export type CampaignPickerOption = Readonly<{
	value: string;
	label: string;
	disambiguation?: string;
	lifecycle?: "active" | "archived";
	disabled?: boolean;
}>;

export type CampaignPickerProps = Readonly<{
	value: string;
	options: readonly CampaignPickerOption[];
	onChange: (value: string) => void;
	ariaLabel: string;
	optional?: boolean;
	generalValue?: string;
	generalLabel?: string;
	placeholderLabel?: string;
	disabled?: boolean;
	pending?: boolean;
	pendingLabel?: string;
	className?: string;
	selectClassName?: string;
	canManage?: boolean;
	canCreate?: boolean;
	onCreate?: () => void;
	createButtonRef?: Ref<HTMLButtonElement>;
	manageHref?: string;
	manageTarget?: "_blank" | "_self";
}>;

export function CampaignPicker({
	value,
	options,
	onChange,
	ariaLabel,
	optional = false,
	generalValue = "",
	generalLabel = "Geral",
	placeholderLabel = "Selecione…",
	disabled = false,
	pending = false,
	pendingLabel = "Abrindo campanha…",
	className,
	selectClassName,
	canManage = false,
	canCreate = false,
	onCreate,
	createButtonRef,
	manageHref = "/edit/campanhas",
	manageTarget = "_blank",
}: CampaignPickerProps) {
	const interactionDisabled = disabled || pending;
	const hasProjectedValue =
		(optional && value === generalValue) ||
		options.some((option) => option.value === value);
	const duplicateCounts = new Map<string, number>();
	for (const option of options) {
		duplicateCounts.set(option.label, (duplicateCounts.get(option.label) ?? 0) + 1);
	}
	const duplicateOrdinals = new Map<string, number>();
	const selectOptions: readonly SelectOption<string>[] = [
		...(!optional && !hasProjectedValue
			? [{ value, label: placeholderLabel, disabled: true }]
			: []),
		...(optional ? [{ value: generalValue, label: generalLabel }] : []),
		...options.map((option) => {
			const duplicate = (duplicateCounts.get(option.label) ?? 0) > 1;
			const ordinal = (duplicateOrdinals.get(option.label) ?? 0) + 1;
			duplicateOrdinals.set(option.label, ordinal);
			const disambiguation = duplicate
				? option.disambiguation?.trim() || `opção ${ordinal}`
				: null;
			return {
				value: option.value,
				label: [
					option.label,
					disambiguation,
					option.lifecycle === "archived" ? "arquivada" : null,
				]
					.filter(Boolean)
					.join(" · "),
				disabled: option.disabled ?? option.lifecycle === "archived",
			};
		}),
	];
	const opensNewTab = manageTarget === "_blank";

	return (
		<div
			className={className ? `${styles.root} ${className}` : styles.root}
			data-pending={pending ? "true" : "false"}
			aria-busy={pending || undefined}
		>
			<Select
				value={value}
				options={selectOptions}
				onChange={onChange}
				ariaLabel={ariaLabel}
				className={selectClassName}
				disabled={interactionDisabled}
			/>
			{pending ? (
				<span className={styles.pending} role="status" aria-live="polite">
					{pendingLabel}
				</span>
			) : null}
			{(canCreate && onCreate) || canManage ? (
				<div className={styles.actions}>
					{canCreate && onCreate ? (
						<button
							ref={createButtonRef}
							type="button"
							className={styles.action}
							onClick={onCreate}
							disabled={interactionDisabled}
						>
							Nova campanha
						</button>
					) : null}
					{canManage ? (
						<a
							className={styles.action}
							href={manageHref}
							target={opensNewTab ? "_blank" : undefined}
							rel={opensNewTab ? "noreferrer" : undefined}
							aria-label={
								opensNewTab
									? "Gerenciar campanhas (abre em nova aba)"
									: "Gerenciar campanhas"
							}
							aria-disabled={interactionDisabled || undefined}
							onClick={
								interactionDisabled
									? (event) => event.preventDefault()
									: undefined
							}
						>
							Gerenciar campanhas
							{opensNewTab ? (
								<span className={styles.external} aria-hidden="true">
									↗
								</span>
							) : null}
						</a>
					) : null}
				</div>
			) : null}
		</div>
	);
}
