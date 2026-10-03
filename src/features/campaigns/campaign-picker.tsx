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

export type CampaignPickerProps = Readonly<{
	value: string;
	options: readonly CampaignPickerOption[];
	onChange: (value: string) => void;
	ariaLabel: string;
	optional?: boolean;
	generalValue?: string;
	generalLabel?: string;
	disabled?: boolean;
	pending?: boolean;
	pendingLabel?: string;
	status?: string;
	className?: string;
	selectClassName?: string;
	canManage?: boolean;
	canCreate?: boolean;
	onCreate?: () => void;
	createButtonRef?: Ref<HTMLButtonElement>;
	manageHref?: string;
}>;

export function campaignPickerOptions(
	options: readonly CampaignPickerOption[],
	config: Readonly<{
		optional?: boolean;
		generalValue?: string;
		generalLabel?: string;
	}> = {},
): readonly SelectOption<string>[] {
	const {
		optional = false,
		generalValue = "",
		generalLabel = "Geral",
	} = config;
	return [
		...(optional ? [{ value: generalValue, label: generalLabel }] : []),
		...options.map((option) => ({
			value: option.value,
			label:
				option.lifecycle === "archived"
					? `${option.label} (arquivada)`
					: option.label,
			disabled: option.disabled ?? option.lifecycle === "archived",
		})),
	];
}

export function CampaignPicker({
	value,
	options,
	onChange,
	ariaLabel,
	optional = false,
	generalValue = "",
	generalLabel = "Geral",
	disabled = false,
	pending = false,
	pendingLabel = "Trocando campanha…",
	status,
	className,
	selectClassName,
	canManage = false,
	canCreate = false,
	onCreate,
	createButtonRef,
	manageHref = "/edit/campanhas",
}: CampaignPickerProps) {
	const selectOptions = campaignPickerOptions(options, {
		optional,
		generalValue,
		generalLabel,
	});
	const busy = disabled || pending;

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
				disabled={busy}
			/>
			<p className={styles.status} role="status" aria-live="polite">
				{pending ? pendingLabel : status ?? ""}
			</p>
			{(canCreate && onCreate) || canManage ? (
				<nav className={styles.actions} aria-label="Ações de campanha">
					{canCreate && onCreate ? (
						<button
							ref={createButtonRef}
							type="button"
							className={styles.action}
							onClick={onCreate}
							disabled={busy}
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
							aria-disabled={busy || undefined}
							onClick={busy ? (event) => event.preventDefault() : undefined}
						>
							Gerenciar campanhas
							<span className={styles.external} aria-hidden="true">
								↗
							</span>
						</a>
					) : null}
				</nav>
			) : null}
		</div>
	);
}
