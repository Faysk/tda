"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
	CampaignPicker,
	type CampaignChoice,
} from "@/features/campaigns/campaign-picker";
import { createCampaignContextAction } from "@/features/campaigns/context-actions";
import { suggestCampaignRouteKey } from "@/features/campaigns/model";
import { Button } from "@/components/ui";
import { refreshLembraCampaignClassificationsAction } from "../actions";
import type { LembraCampaignClassification } from "../model";
import styles from "./lembra-campaign-picker.module.css";

type Props = Readonly<{
	value: string | null;
	campaigns: readonly LembraCampaignClassification[];
	onChange: (campaignId: string | null) => void;
	onCampaignsChange: (
		campaigns: readonly LembraCampaignClassification[],
	) => void;
	onStatus: (message: string) => void;
	canManageCampaigns?: boolean;
	disabled?: boolean;
	ariaLabel?: string;
}>;

function createFailureMessage(reason: string) {
	if (reason === "forbidden") return "Você não tem permissão para criar campanhas.";
	if (reason === "profile_unresolved")
		return "Seu perfil ainda não está pronto para administrar campanhas.";
	if (reason === "conflict")
		return "Esse identificador ou rota já está em uso. Ajuste os detalhes avançados.";
	if (reason === "validation")
		return "Revise os campos. Nome, identificadores e rota precisam ser válidos.";
	return "Não foi possível criar a campanha agora.";
}

export function LembraCampaignPicker({
	value,
	campaigns,
	onChange,
	onCampaignsChange,
	onStatus,
	canManageCampaigns = false,
	disabled = false,
	ariaLabel = "Campanha da referência",
}: Props) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const technicalTouched = useRef(false);
	const routeTouched = useRef(false);
	const [mounted, setMounted] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [visibility, setVisibility] = useState<"private" | "public">("private");
	const [technicalSlug, setTechnicalSlug] = useState("");
	const [routeKey, setRouteKey] = useState("");

	const choices: readonly CampaignChoice<string>[] = campaigns.map((campaign) => ({
		value: campaign.id,
		label: campaign.name,
		lifecycle: campaign.lifecycle,
	}));

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (dialogOpen && !dialog.open) {
			dialog.showModal();
			requestAnimationFrame(() => nameRef.current?.focus());
		} else if (!dialogOpen && dialog.open) {
			dialog.close();
		}
	}, [dialogOpen]);

	function resetForm() {
		setError("");
		setName("");
		setDescription("");
		setVisibility("private");
		setTechnicalSlug("");
		setRouteKey("");
		technicalTouched.current = false;
		routeTouched.current = false;
	}

	function openCreate() {
		resetForm();
		setDialogOpen(true);
	}

	function closeCreate() {
		if (saving) return;
		setDialogOpen(false);
	}

	function updateName(nextName: string) {
		setName(nextName);
		const suggested = suggestCampaignRouteKey(nextName);
		if (!technicalTouched.current) setTechnicalSlug(suggested);
		if (!routeTouched.current) setRouteKey(suggested);
	}

	async function submitCreate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		setError("");
		try {
			const result = await createCampaignContextAction({
				name,
				technicalSlug,
				routeKey,
				description,
				visibility,
			});
			if (!result.ok) {
				setError(createFailureMessage(result.reason));
				return;
			}

			const refreshed = await refreshLembraCampaignClassificationsAction();
			if (!refreshed.ok) {
				onStatus(
					"Campanha criada, mas o Lembra não conseguiu atualizar as opções agora. Seu rascunho foi preservado.",
				);
				setDialogOpen(false);
				return;
			}

			onCampaignsChange(refreshed.campaigns);
			const eligible = refreshed.campaigns.find(
				(campaign) =>
					campaign.id === result.campaign.id && campaign.lifecycle === "active",
			);
			if (eligible) {
				onChange(eligible.id);
				onStatus(`Campanha “${eligible.name}” criada e selecionada.`);
			} else {
				onStatus(
					"Campanha criada. Ela não está disponível neste seletor com o seu acesso atual; a seleção anterior foi mantida.",
				);
			}
			setDialogOpen(false);
		} catch {
			setError("Não foi possível criar a campanha agora.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<>
			<CampaignPicker
				value={value ?? ""}
				choices={choices}
				onChange={(next) => onChange(next || null)}
				ariaLabel={ariaLabel}
				optional
				generalLabel="Geral"
				hint="Opcional. Geral mantém a referência fora de qualquer classificação de campanha."
				disabled={disabled}
				canCreate={canManageCampaigns}
				onCreate={openCreate}
				canManage={canManageCampaigns}
			/>
			{mounted
				? createPortal(
						<dialog
							ref={dialogRef}
							className={styles.dialog}
							aria-labelledby="lembra-create-campaign-title"
							onCancel={(event) => {
								event.preventDefault();
								closeCreate();
							}}
							onClose={() => setDialogOpen(false)}
						>
							<form className={styles.form} onSubmit={submitCreate}>
								<header className={styles.header}>
									<div>
										<p>Campanhas</p>
										<h2 id="lembra-create-campaign-title">Nova campanha</h2>
										<span>Ela será criada no gerenciador canônico sem fechar seu rascunho do Lembra.</span>
									</div>
									<button
										type="button"
										className={styles.close}
										onClick={closeCreate}
										disabled={saving}
										aria-label="Fechar criação de campanha"
									>
										×
									</button>
								</header>

								<label>
									<span>Nome</span>
									<input
										ref={nameRef}
										value={name}
										onChange={(event) => updateName(event.target.value)}
										required
										maxLength={120}
										autoComplete="off"
										disabled={saving}
									/>
								</label>

								<label>
									<span>Visibilidade</span>
									<select
										value={visibility}
										onChange={(event) =>
											setVisibility(event.target.value as "private" | "public")
										}
										disabled={saving}
									>
										<option value="private">Privada</option>
										<option value="public">Pública</option>
									</select>
									<small>
										Privada afeta descoberta da campanha, não a regra global de acesso às imagens do Lembra.
									</small>
								</label>

								<label>
									<span>Descrição</span>
									<textarea
										value={description}
										onChange={(event) => setDescription(event.target.value)}
										maxLength={600}
										rows={3}
										disabled={saving}
									/>
								</label>

								<details className={styles.advanced}>
									<summary>Detalhes avançados</summary>
									<div>
										<label>
											<span>Slug técnico</span>
											<input
												value={technicalSlug}
												onChange={(event) => {
													technicalTouched.current = true;
													setTechnicalSlug(event.target.value);
												}}
												required
												pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
												maxLength={80}
												autoComplete="off"
												disabled={saving}
											/>
										</label>
										<label>
											<span>Rota pública</span>
											<input
												value={routeKey}
												onChange={(event) => {
													routeTouched.current = true;
													setRouteKey(event.target.value);
												}}
												required
												pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
												maxLength={80}
												autoComplete="off"
												disabled={saving}
											/>
										</label>
										<small>
											Esses identificadores nascem estáveis. Renomear a campanha depois não altera o slug técnico.
										</small>
									</div>
								</details>

								{error ? (
									<p className={styles.error} role="alert">
										{error}
									</p>
								) : null}

								<footer className={styles.actions}>
									<Button
										type="button"
										variant="tertiary"
										onClick={closeCreate}
										disabled={saving}
									>
										Cancelar
									</Button>
									<Button
										type="submit"
										variant="primary"
										pending={saving}
										pendingLabel="Criando…"
									>
										Criar campanha
									</Button>
								</footer>
							</form>
						</dialog>,
						document.body,
					)
				: null}
		</>
	);
}
