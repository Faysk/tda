"use client";

import {
	type ComponentProps,
	type FormEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui";
import {
	clearStaleActionRecovery,
	isNextRedirectSignal,
	isStaleServerActionError,
	persistStaleActionRecovery,
	readStaleActionRecovery,
} from "./stale-action-recovery";

type FormPatch = Readonly<{
	fields: ReadonlyArray<
		Readonly<{
			name: string;
			values: readonly string[];
		}>
	>;
}>;

type FormControl =
	| HTMLInputElement
	| HTMLSelectElement
	| HTMLTextAreaElement;

type Props = Omit<ComponentProps<"form">, "action" | "onSubmit"> &
	Readonly<{
		children: ReactNode;
		serverAction: (formData: FormData) => void | Promise<void>;
		recoveryKey: string;
		noticeClassName?: string;
	}>;

function editableControls(form: HTMLFormElement): FormControl[] {
	return Array.from(form.elements).filter((element): element is FormControl => {
		if (
			!(
				element instanceof HTMLInputElement ||
				element instanceof HTMLSelectElement ||
				element instanceof HTMLTextAreaElement
			) ||
			!element.name
		) {
			return false;
		}
		if (element instanceof HTMLInputElement) {
			return !["hidden", "file", "button", "submit", "reset", "image"].includes(
				element.type,
			);
		}
		return true;
	});
}

function valuesForControls(controls: readonly FormControl[]): string[] {
	const first = controls[0];
	if (!first) return [];
	if (
		first instanceof HTMLInputElement &&
		(first.type === "checkbox" || first.type === "radio")
	) {
		return controls.flatMap((control) =>
			control instanceof HTMLInputElement && control.checked
				? [control.value]
				: [],
		);
	}
	if (first instanceof HTMLSelectElement) {
		return Array.from(first.selectedOptions, (option) => option.value);
	}
	return [first.value];
}

function defaultValuesForControls(controls: readonly FormControl[]): string[] {
	const first = controls[0];
	if (!first) return [];
	if (
		first instanceof HTMLInputElement &&
		(first.type === "checkbox" || first.type === "radio")
	) {
		return controls.flatMap((control) =>
			control instanceof HTMLInputElement && control.defaultChecked
				? [control.value]
				: [],
		);
	}
	if (first instanceof HTMLSelectElement) {
		const explicit = Array.from(first.options).filter(
			(option) => option.defaultSelected,
		);
		if (explicit.length) return explicit.map((option) => option.value);
		return first.multiple || !first.options[0] ? [] : [first.options[0].value];
	}
	return [first.defaultValue];
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function captureDirtyFormPatch(form: HTMLFormElement): FormPatch {
	const controls = editableControls(form);
	const names = Array.from(new Set(controls.map((control) => control.name)));
	return {
		fields: names.flatMap((name) => {
			const group = controls.filter((control) => control.name === name);
			const values = valuesForControls(group);
			const defaults = defaultValuesForControls(group);
			return sameValues(values, defaults) ? [] : [{ name, values }];
		}),
	};
}

function applyFormPatch(form: HTMLFormElement, patch: FormPatch): boolean {
	const controls = editableControls(form);
	let applied = false;
	for (const field of patch.fields) {
		const group = controls.filter((control) => control.name === field.name);
		if (!group.length) continue;
		const first = group[0];
		if (
			first instanceof HTMLInputElement &&
			(first.type === "checkbox" || first.type === "radio")
		) {
			for (const control of group) {
				if (!(control instanceof HTMLInputElement)) continue;
				control.checked = field.values.includes(control.value);
			}
			applied = true;
			continue;
		}
		if (first instanceof HTMLSelectElement) {
			for (const option of Array.from(first.options)) {
				option.selected = field.values.includes(option.value);
			}
			applied = true;
			continue;
		}
		first.value = field.values[0] ?? "";
		applied = true;
	}
	return applied;
}

export function RecoverableActionForm({
	children,
	serverAction,
	recoveryKey,
	noticeClassName,
	...formProps
}: Props) {
	const formRef = useRef<HTMLFormElement>(null);
	const inFlightRef = useRef(false);
	const [state, setState] = useState<
		"idle" | "stale" | "restored" | "uncertain"
	>("idle");

	useEffect(() => {
		const patch = readStaleActionRecovery<FormPatch>(recoveryKey);
		if (!patch) return;
		const frame = window.requestAnimationFrame(() => {
			if (formRef.current && applyFormPatch(formRef.current, patch)) {
				setState("restored");
			}
		});
		return () => window.cancelAnimationFrame(frame);
	}, [recoveryKey]);

	function persistCurrentPatch() {
		if (!formRef.current) return;
		persistStaleActionRecovery(
			recoveryKey,
			captureDirtyFormPatch(formRef.current),
		);
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (inFlightRef.current) return;
		const form = event.currentTarget;
		const formData = new FormData(form);
		const openDisclosures: HTMLDetailsElement[] = [];
		let ancestor = form.parentElement;
		while (ancestor) {
			if (ancestor instanceof HTMLDetailsElement && ancestor.open) {
				openDisclosures.push(ancestor);
			}
			ancestor = ancestor.parentElement;
		}
		for (const details of openDisclosures) details.open = false;

		inFlightRef.current = true;
		setState("idle");
		try {
			await serverAction(formData);
			clearStaleActionRecovery(recoveryKey);
		} catch (error) {
			if (isNextRedirectSignal(error)) {
				clearStaleActionRecovery(recoveryKey);
				return;
			}
			for (const details of openDisclosures) details.open = true;
			if (isStaleServerActionError(error)) {
				persistStaleActionRecovery(recoveryKey, captureDirtyFormPatch(form));
				setState("stale");
				return;
			}
			setState("uncertain");
		} finally {
			inFlightRef.current = false;
		}
	}

	return (
		<form
			{...formProps}
			ref={formRef}
			onInput={() => {
				if (state === "restored") persistCurrentPatch();
			}}
			onSubmit={(event) => void submit(event)}
			aria-busy={inFlightRef.current || undefined}
			data-stale-action-state={state === "idle" ? undefined : state}
		>
			{state !== "idle" ? (
				<div
					className={noticeClassName}
					data-stale-action-recovery
					role={state === "restored" ? "status" : "alert"}
				>
					{state === "stale" ? (
						<>
							<p>
								O TDA foi atualizado enquanto esta tela estava aberta. Esta
								tentativa antiga não foi executada; seu rascunho continua aqui.
							</p>
							<Button
								size="sm"
								variant="secondary"
								onClick={() => {
									persistCurrentPatch();
									window.location.reload();
								}}
							>
								Atualizar e recuperar rascunho
							</Button>
						</>
					) : state === "restored" ? (
						<p>
							Rascunho recuperado após a atualização do TDA. Revise os campos e
							salve novamente quando estiver pronto.
						</p>
					) : (
						<p>
							Não foi possível confirmar o resultado do envio. Os campos foram
							mantidos nesta tela e nenhuma repetição automática foi feita.
							Confira o estado atual antes de enviar de novo.
						</p>
					)}
				</div>
			) : null}
			{children}
		</form>
	);
}
