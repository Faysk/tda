"use client";

import {
	useEffect,
	useId,
	useRef,
	useState,
	type FormEvent,
	type RefObject,
} from "react";
import { Button, Select } from "@/components/ui";
import type {
	CampaignCreateInput,
	CampaignMutationResult,
	CampaignVisibility,
	ManageableCampaign,
} from "./model";
import styles from "./campaign-create-dialog.module.css";

type CampaignCreateMutation = (
	input: CampaignCreateInput,
) => Promise<CampaignMutationResult>;

type CampaignCreateDialogProps = Readonly<{
	open: boolean;
	onClose: () => void;
	onCreated: (campaign: ManageableCampaign) => void;
	createCampaign: CampaignCreateMutation;
	returnFocusRef?: RefObject<HTMLButtonElement | null>;
	defaultVisibility?: CampaignVisibility;
}>;

type FieldName =
	| "name"
	| "technicalSlug"
	| "routeKey"
	| "description"
	| "visibility";

function failureMessage(result: Extract<CampaignMutationResult, { ok: false }>) {
	switch (result.reason) {
		case "conflict":
			return "Já existe uma campanha com esse slug ou rota. Ajuste os campos e tente novamente.";
		case "dependency_unavailable":
			return "O Campaign Registry está temporariamente indisponível. Seu rascunho do Lembra continua intacto.";
		case "unauthenticated":
			return "Sua sessão expirou. Entre novamente antes de criar a campanha.";
		case "profile_unresolved":
		case "forbidden":
			return "Sua conta não possui permissão para criar campanhas.";
		case "not_found":
			return "Não foi possível reler a campanha criada.";
		default:
			return "Revise os campos destacados e tente novamente.";
	}
}

function fieldMessage(field: FieldName) {
	switch (field) {
		case "name":
			return "Informe um nome entre 2 e 120 caracteres.";
		case "technicalSlug":
			return "Use apenas letras minúsculas, números e hífens no slug técnico.";
		case "routeKey":
			return "Use apenas letras minúsculas, números e hífens na rota pública.";
		case "description":
			return "A descrição pode ter até 600 caracteres.";
		case "visibility":
			return "Escolha se a campanha será pública ou privada.";
	}
}

function formText(formData: FormData, key: string) {
	const value = formData.get(key);
	return typeof value === "string" ? value : "";
}

export function CampaignCreateDialog({
	open,
	onClose,
	onCreated,
	createCampaign,
	returnFocusRef,
	defaultVisibility = "private",
}: CampaignCreateDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const formRef = useRef<HTMLFormElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const [pending, setPending] = useState(false);
	const [generalError, setGeneralError] = useState("");
	const [fieldError, setFieldError] = useState<FieldName | null>(null);
	const titleId = useId();
	const errorId = useId();

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;

		if (open && !dialog.open) {
			formRef.current?.reset();
			setGeneralError("");
			setFieldError(null);
			dialog.showModal();
			nameRef.current?.focus();
			return;
		}

		if (!open && dialog.open) {
			dialog.close();
			requestAnimationFrame(() => returnFocusRef?.current?.focus());
		}
	}, [open, returnFocusRef]);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending) return;
		const formData = new FormData(event.currentTarget);
		const input: CampaignCreateInput = {
			name: formText(formData, "name"),
			technicalSlug: formText(formData, "technicalSlug"),
			routeKey: formText(formData, "routeKey"),
			description: formText(formData, "description"),
			visibility: formText(formData, "visibility"),
		};

		setPending(true);
		setGeneralError("");
		setFieldError(null);
		try {
			const result = await createCampaign(input);
			if (!result.ok) {
				const nextField =
					result.reason === "validation" && result.field
						? result.field
						: null;
				setFieldError(nextField);
				setGeneralError(failureMessage(result));
				requestAnimationFrame(() => {
					if (!nextField) return;
					const field = formRef.current?.elements.namedItem(nextField);
					if (field instanceof HTMLElement && field.getAttribute("type") !== "hidden") {
						field.focus();
						return;
					}
					formRef.current
						?.querySelector<HTMLElement>(`[data-form-control-name="${nextField}"]`)
						?.focus();
				});
				return;
			}
			onCreated(result.campaign);
			onClose();
		} catch {
			setGeneralError(
				"Não foi possível criar a campanha agora. Seu rascunho do Lembra continua intacto.",
			);
		} finally {
			setPending(false);
		}
	}

	function describedBy(field: FieldName) {
		return fieldError === field ? `${errorId}-${field}` : undefined;
	}

	return (
		<dialog
			ref={dialogRef}
			className={styles.dialog}
			aria-labelledby={titleId}
			onCancel={(event) => {
				event.preventDefault();
				if (!pending) onClose();
			}}
		>
			<form ref={formRef} className={styles.form} onSubmit={submit} aria-busy={pending}>
				<header className={styles.header}>
					<div>
						<p>Campanhas</p>
						<h2 id={titleId}>Criar campanha</h2>
						<span>
							Crie a identidade aqui e volte ao Lembra sem perder a imagem ou os campos já preenchidos.
						</span>
					</div>
					<button
						type="button"
						className={styles.close}
						onClick={onClose}
						disabled={pending}
						aria-label="Fechar criação de campanha"
					>
						<span aria-hidden="true">×</span>
					</button>
				</header>

				<div className={styles.fields}>
					<label>
						<span>Nome</span>
						<input
							ref={nameRef}
							name="name"
							required
							maxLength={120}
							autoComplete="off"
							aria-invalid={fieldError === "name" || undefined}
							aria-describedby={describedBy("name")}
						/>
						{fieldError === "name" ? (
							<small id={`${errorId}-name`} className={styles.fieldError}>
								{fieldMessage("name")}
							</small>
						) : null}
					</label>
					<label>
						<span>Slug técnico</span>
						<input
							name="technicalSlug"
							required
							pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
							maxLength={80}
							autoComplete="off"
							placeholder="minha-campanha"
							aria-invalid={fieldError === "technicalSlug" || undefined}
							aria-describedby={describedBy("technicalSlug")}
						/>
						{fieldError === "technicalSlug" ? (
							<small id={`${errorId}-technicalSlug`} className={styles.fieldError}>
								{fieldMessage("technicalSlug")}
							</small>
						) : null}
					</label>
					<label>
						<span>Rota pública</span>
						<input
							name="routeKey"
							required
							pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
							maxLength={80}
							autoComplete="off"
							placeholder="minha-campanha"
							aria-invalid={fieldError === "routeKey" || undefined}
							aria-describedby={describedBy("routeKey")}
						/>
						{fieldError === "routeKey" ? (
							<small id={`${errorId}-routeKey`} className={styles.fieldError}>
								{fieldMessage("routeKey")}
							</small>
						) : null}
					</label>
					<div>
						<span>Visibilidade inicial</span>
						<Select
							name="visibility"
							defaultValue={defaultVisibility}
							options={[
								{ value: "public", label: "Pública · pode classificar referências" },
								{ value: "private", label: "Privada · não aparece no Lembra" },
							]}
							ariaLabel="Visibilidade inicial"
							ariaInvalid={fieldError === "visibility"}
							ariaDescribedBy={describedBy("visibility")}
							required
						/>
						{fieldError === "visibility" ? (
							<small id={`${errorId}-visibility`} className={styles.fieldError}>
								{fieldMessage("visibility")}
							</small>
						) : null}
					</div>
					<label className={styles.full}>
						<span>Descrição</span>
						<textarea
							name="description"
							maxLength={600}
							rows={3}
							aria-invalid={fieldError === "description" || undefined}
							aria-describedby={describedBy("description")}
						/>
						{fieldError === "description" ? (
							<small id={`${errorId}-description`} className={styles.fieldError}>
								{fieldMessage("description")}
							</small>
						) : null}
					</label>
				</div>

				{generalError ? (
					<p className={styles.error} role="alert" aria-live="assertive">
						{generalError}
					</p>
				) : null}

				<footer className={styles.actions}>
					<Button
						type="button"
						variant="tertiary"
						onClick={onClose}
						disabled={pending}
					>
						Cancelar
					</Button>
					<Button
						type="submit"
						variant="primary"
						pending={pending}
						pendingLabel="Criando…"
					>
						Criar e voltar
					</Button>
				</footer>
			</form>
		</dialog>
	);
}
