"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
	ActionLink,
	Button,
	Select,
	type SelectOption,
} from "@/components/ui";
import {
	buildCampaignPickerItems,
	CAMPAIGN_PICKER_UNSET,
	campaignValueForControl,
	selectedCampaignControlValue,
	type CampaignChoice,
} from "./picker-model";
import styles from "./campaign-picker.module.css";

export type CampaignPickerAction =
	| Readonly<{ label: string; href: string; onAction?: never }>
	| Readonly<{ label: string; href?: never; onAction: () => void }>;

type CampaignPickerProps<TValue extends string | null> = Readonly<{
	value: TValue | undefined;
	options: readonly CampaignChoice<TValue>[];
	onChange: (value: TValue) => void;
	label?: string;
	ariaLabel?: string;
	placeholder?: string;
	helperText?: ReactNode;
	pending?: boolean;
	pendingLabel?: string;
	disabled?: boolean;
	className?: string;
	manageAction?: CampaignPickerAction;
	createAction?: CampaignPickerAction;
}>;

function CampaignAction({ action }: { action: CampaignPickerAction }) {
	if ("href" in action && action.href) {
		return (
			<ActionLink href={action.href} size="sm" variant="tertiary">
				{action.label}
			</ActionLink>
		);
	}
	return (
		<Button size="sm" variant="tertiary" onClick={action.onAction}>
			{action.label}
		</Button>
	);
}

export function CampaignPicker<TValue extends string | null>({
	value,
	options,
	onChange,
	label = "Campanha",
	ariaLabel = "Campanha",
	placeholder = "Selecione uma campanha",
	helperText,
	pending = false,
	pendingLabel = "Trocando campanha…",
	disabled = false,
	className,
	manageAction,
	createAction,
}: CampaignPickerProps<TValue>) {
	const items = useMemo(() => buildCampaignPickerItems(options), [options]);
	const selectedControl = selectedCampaignControlValue(items, value);
	const needsPlaceholder = selectedControl === undefined;
	const selectOptions = useMemo<readonly SelectOption<string>[]>(() => {
		const projected = items.map((item) => ({
			value: item.controlValue,
			label: item.label,
			disabled: item.disabled,
		}));
		return needsPlaceholder
			? [
					{
						value: CAMPAIGN_PICKER_UNSET,
						label: placeholder,
						disabled: true,
					},
					...projected,
				]
			: projected;
	}, [items, needsPlaceholder, placeholder]);
	const noDestination = items.every((item) => item.disabled);

	return (
		<div
			className={[styles.root, className].filter(Boolean).join(" ")}
			data-campaign-picker="true"
			aria-busy={pending || undefined}
		>
			<span className={styles.label}>{label}</span>
			<Select
				ariaLabel={ariaLabel}
				className={styles.select}
				disabled={disabled || pending || noDestination}
				onChange={(controlValue) => {
					const next = campaignValueForControl(items, controlValue);
					if (next !== undefined) onChange(next);
				}}
				options={selectOptions}
				value={selectedControl ?? CAMPAIGN_PICKER_UNSET}
			/>
			{pending ? (
				<p className={styles.pending} role="status" aria-live="polite">
					{pendingLabel}
				</p>
			) : helperText ? (
				<p className={styles.helper}>{helperText}</p>
			) : null}
			{manageAction || createAction ? (
				<div className={styles.actions} aria-label="Ações de campanha">
					{manageAction ? <CampaignAction action={manageAction} /> : null}
					{createAction ? <CampaignAction action={createAction} /> : null}
				</div>
			) : null}
		</div>
	);
}

export type CampaignRouteChoice<TValue extends string = string> =
	CampaignChoice<TValue> &
		Readonly<{
			href: string;
		}>;

type CampaignRoutePickerProps<TValue extends string> = Readonly<{
	currentValue: TValue | undefined;
	options: readonly CampaignRouteChoice<TValue>[];
	behavior: "immediate" | "confirm";
	label?: string;
	ariaLabel?: string;
	placeholder?: string;
	actionLabel?: string;
	className?: string;
	manageAction?: CampaignPickerAction;
	createAction?: CampaignPickerAction;
	onBeforeNavigate?: (value: TValue) => boolean;
}>;

export function CampaignRoutePicker<TValue extends string>({
	currentValue,
	options,
	behavior,
	label = "Campanha",
	ariaLabel = "Campanha",
	placeholder = "Selecione uma campanha",
	actionLabel = "Abrir campanha",
	className,
	manageAction,
	createAction,
	onBeforeNavigate,
}: CampaignRoutePickerProps<TValue>) {
	const router = useRouter();
	const [selection, setSelection] = useState<TValue | undefined>(currentValue);
	const [navigatingValue, setNavigatingValue] = useState<TValue | null>(null);
	const [transitionPending, startTransition] = useTransition();

	useEffect(() => {
		setSelection(currentValue);
		setNavigatingValue(null);
	}, [currentValue]);

	const current = options.find((option) => option.value === currentValue);
	const selected = options.find((option) => option.value === selection);
	const navigating = options.find((option) => option.value === navigatingValue);
	const pending = transitionPending || navigatingValue !== null;

	function navigate(value: TValue) {
		const target = options.find(
			(option) => option.value === value && !option.disabled,
		);
		if (!target || target.value === currentValue) {
			setSelection(currentValue);
			return;
		}
		if (onBeforeNavigate && !onBeforeNavigate(value)) {
			setSelection(currentValue);
			return;
		}
		setNavigatingValue(value);
		startTransition(() => router.push(target.href));
	}

	const helperText =
		behavior === "immediate"
			? current
				? `Contexto atual: ${current.label}. A troca é aplicada ao selecionar.`
				: "Escolha uma campanha para continuar."
			: selected && selected.value !== currentValue
				? current
					? `Seleção pronta: ${selected.label}. Você continua em ${current.label} até confirmar.`
					: `Seleção pronta: ${selected.label}. Confirme para continuar.`
				: current
					? `Contexto atual: ${current.label}.`
					: "Escolha uma campanha e confirme para continuar.";

	const picker = (
		<CampaignPicker
			ariaLabel={ariaLabel}
			createAction={createAction}
			helperText={helperText}
			label={label}
			manageAction={manageAction}
			onChange={(next) => {
				setSelection(next);
				if (behavior === "immediate") navigate(next);
			}}
			options={options}
			pending={pending}
			pendingLabel={`Abrindo ${navigating?.label ?? selected?.label ?? "campanha"}…`}
			placeholder={placeholder}
			value={selection}
		/>
	);

	if (behavior === "immediate") {
		return <div className={className}>{picker}</div>;
	}

	const canCommit =
		selection !== undefined &&
		selection !== currentValue &&
		Boolean(options.find((option) => option.value === selection && !option.disabled));

	return (
		<div className={[styles.route, className].filter(Boolean).join(" ")}>
			{picker}
			<Button
				className={styles.commit}
				disabled={!canCommit}
				onClick={() => {
					if (selection !== undefined) navigate(selection);
				}}
				pending={pending}
				pendingLabel="Abrindo…"
				variant="primary"
			>
				{actionLabel}
			</Button>
		</div>
	);
}
