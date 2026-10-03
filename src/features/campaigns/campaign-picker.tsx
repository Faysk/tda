"use client";

import { Button, Select, type SelectOption } from "@/components/ui";
import styles from "./campaign-picker.module.css";

export type CampaignChoice<T extends string = string> = Readonly<{
	value: T;
	label: string;
	lifecycle?: "active" | "archived";
	disabled?: boolean;
}>;

type CampaignPickerProps<T extends string> = Readonly<{
	value: T | "";
	choices: readonly CampaignChoice<T>[];
	onChange: (value: T | "") => void;
	ariaLabel: string;
	label?: string;
	hint?: string;
	optional?: boolean;
	generalLabel?: string;
	disabled?: boolean;
	canCreate?: boolean;
	onCreate?: () => void;
	canManage?: boolean;
	manageHref?: string;
}>;

/**
 * Shared campaign-choice primitive.
 *
 * The picker deliberately treats option values as opaque domain values. Consumers
 * adapt UUIDs, technical slugs or other identifiers themselves; this component
 * never converts campaign identity and never makes an authorization decision.
 */
export function CampaignPicker<T extends string>({
	value,
	choices,
	onChange,
	ariaLabel,
	label = "Campanha",
	hint,
	optional = false,
	generalLabel = "Geral",
	disabled = false,
	canCreate = false,
	onCreate,
	canManage = false,
	manageHref = "/edit/campanhas",
}: CampaignPickerProps<T>) {
	const options: readonly SelectOption<string>[] = [
		...(optional ? [{ value: "", label: generalLabel }] : []),
		...choices.map((choice) => ({
			value: choice.value,
			label:
				choice.lifecycle === "archived"
					? `${choice.label} · arquivada`
					: choice.label,
			disabled: choice.disabled || choice.lifecycle === "archived",
		})),
	];

	return (
		<div className={styles.root}>
			<div className={styles.field}>
				<span className={styles.label}>{label}</span>
				<Select
					value={value}
					options={options}
					onChange={(next) => onChange(next as T | "")}
					ariaLabel={ariaLabel}
					disabled={disabled}
				/>
				{hint ? <small className={styles.hint}>{hint}</small> : null}
			</div>
			{canCreate || canManage ? (
				<fieldset className={styles.actions} aria-label="Ações de campanha">
					{canCreate && onCreate ? (
						<Button
							type="button"
							size="sm"
							variant="tertiary"
							onClick={onCreate}
							disabled={disabled}
						>
							+ Nova campanha
						</Button>
					) : null}
					{canManage ? (
						<a
							className={styles.manage}
							href={manageHref}
							target="_blank"
							rel="noreferrer"
						>
							Gerenciar campanhas
							<span className={styles.srOnly}> (abre em nova aba)</span>
						</a>
					) : null}
				</fieldset>
			) : null}
		</div>
	);
}
