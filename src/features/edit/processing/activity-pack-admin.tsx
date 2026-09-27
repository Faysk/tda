"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	ACTIVITY_PACK_VARIABLES,
	activityPackExample,
	activityPackPrompt,
	type ActivityPack,
	parseActivityPackJson,
	serializeActivityPack,
} from "./activity-pack";
import {
	loadActivityPacks,
	saveActivityPacks,
} from "./activity-pack-store";
import styles from "./processing.module.css";

function downloadJson(name: string, body: string) {
	const blob = new Blob([body], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	URL.revokeObjectURL(url);
}

export function ActivityPackAdmin({ scope }: Readonly<{ scope: string }>) {
	const [packs, setPacks] = useState<ActivityPack[]>(() => loadActivityPacks(scope));
	const [preview, setPreview] = useState<ActivityPack | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [dragging, setDragging] = useState(false);
	const example = useMemo(activityPackExample, []);
	const prompt = useMemo(activityPackPrompt, []);
	const variables = ACTIVITY_PACK_VARIABLES.filter((item) =>
		[item.name, item.type, item.when]
			.join(" ")
			.toLocaleLowerCase("pt-BR")
			.includes(query.trim().toLocaleLowerCase("pt-BR")),
	);

	function persist(next: readonly ActivityPack[]) {
		const copy = [...next];
		saveActivityPacks(scope, copy);
		setPacks(copy);
	}

	async function read(file: File | undefined) {
		if (!file) return;
		try {
			const parsed = parseActivityPackJson(await file.text());
			// Imported content is untrusted and never self-activates.
			setPreview({ ...parsed, enabled: false });
			setError(null);
		} catch (cause) {
			setPreview(null);
			setError(cause instanceof Error ? cause.message : "PACK_INVALID");
		}
	}

	function commitPreview(replace: boolean) {
		if (!preview) return;
		const current = packs.find((pack) => pack.id === preview.id);
		if (current && !replace) {
			setError("PACK_ID_CONFLICT");
			return;
		}
		const next = current
			? packs.map((pack) => (pack.id === preview.id ? preview : pack))
			: [...packs, preview];
		persist(next);
		setPreview(null);
		setError(null);
	}

	function toggle(pack: ActivityPack) {
		persist(
			packs.map((item) =>
				item.id === pack.id ? { ...item, enabled: !item.enabled } : item,
			),
		);
	}

	function exportAll() {
		downloadJson(
			"tda-activity-packs.json",
			JSON.stringify(
				packs.map((pack) => JSON.parse(serializeActivityPack(pack))),
				null,
				2,
			),
		);
	}

	const conflict = preview ? packs.some((pack) => pack.id === preview.id) : false;

	return (
		<details className={styles.barkPackAdmin}>
			<summary>Linguiça no Log</summary>
			<div className={styles.barkPackIntro}>
				<p>
					Pacotes browser-local de frases, roasts e absurdos. O JSON é dado não
					confiável: ele é validado antes de entrar no catálogo e nunca executa
					código.
				</p>
				<p>
					Storage local deste navegador/perfil. Alterar localStorage por DevTools
					não é tratado como uma fronteira de segurança.
				</p>
			</div>

			<div
				className={styles.barkPackDrop}
				data-dragging={dragging}
				onDragEnter={(event) => {
					event.preventDefault();
					setDragging(true);
				}}
				onDragOver={(event) => event.preventDefault()}
				onDragLeave={() => setDragging(false)}
				onDrop={(event) => {
					event.preventDefault();
					setDragging(false);
					void read(event.dataTransfer.files?.[0]);
				}}
			>
				<strong>Arraste seu pack JSON aqui</strong>
				<span>ou use o seletor de arquivo</span>
				<label>
					<span className={styles.visuallyHidden}>Escolher pack JSON</span>
					<input
						type="file"
						accept="application/json,.json"
						onChange={(event) => void read(event.target.files?.[0])}
					/>
				</label>
			</div>

			<div className={styles.barkPackActions}>
				<Button
					size="sm"
					variant="tertiary"
					onClick={() => void navigator.clipboard.writeText(example)}
				>
					Copiar exemplo JSON
				</Button>
				<Button
					size="sm"
					variant="tertiary"
					onClick={() => void navigator.clipboard.writeText(prompt)}
				>
					Copiar prompt para IA
				</Button>
				<Button
					size="sm"
					variant="tertiary"
					disabled={!packs.length}
					onClick={exportAll}
				>
					Exportar meus packs
				</Button>
			</div>

			{error ? <p className={styles.barkPackError} role="alert">Pack recusado · {error}</p> : null}

			{preview ? (
				<section className={styles.barkPackPreview} aria-label="Pré-visualização do pack">
					<div>
						<strong>{preview.name} · v{preview.version}</strong>
						<span>
							{preview.templates.length} templates válidos · {preview.language} ·
							importa desativado
						</span>
					</div>
					<blockquote>{preview.templates[0]?.text}</blockquote>
					<div className={styles.barkPackActions}>
						<Button size="sm" onClick={() => commitPreview(false)} disabled={conflict}>
							Adicionar desativado
						</Button>
						{conflict ? (
							<Button size="sm" variant="tertiary" onClick={() => commitPreview(true)}>
								Substituir pack existente
							</Button>
						) : null}
						<Button size="sm" variant="tertiary" onClick={() => setPreview(null)}>
							Cancelar
						</Button>
					</div>
				</section>
			) : null}

			<section className={styles.barkPackLibrary} aria-labelledby="bark-pack-library-title">
				<div className={styles.barkPackSectionTitle}>
					<strong id="bark-pack-library-title">Biblioteca</strong>
					<span>OFICIAL · TDA Core Chaos permanece separado e ativo</span>
				</div>
				{packs.length ? (
					<ul className={styles.barkPackList}>
						{packs.map((pack) => (
							<li key={pack.id}>
								<div>
									<strong>{pack.name}</strong>
									<span>
										{pack.id} · v{pack.version} · {pack.templates.length} frases ·{" "}
										{pack.enabled ? "ativo" : "pausado"}
									</span>
								</div>
								<div className={styles.barkPackActions}>
									<Button size="sm" variant="tertiary" onClick={() => toggle(pack)}>
										{pack.enabled ? "Desativar" : "Ativar"}
									</Button>
									<Button
										size="sm"
										variant="tertiary"
										onClick={() => downloadJson(`${pack.id}.json`, serializeActivityPack(pack))}
									>
										Exportar
									</Button>
									<Button
										size="sm"
										variant="tertiary"
										onClick={() => persist(packs.filter((item) => item.id !== pack.id))}
									>
										Remover
									</Button>
								</div>
							</li>
						))}
					</ul>
				) : (
					<p>Nenhum pack custom importado neste navegador/perfil.</p>
				)}
			</section>

			<section className={styles.barkPackVariables} aria-labelledby="bark-pack-variables-title">
				<div className={styles.barkPackSectionTitle}>
					<strong id="bark-pack-variables-title">Variáveis e conditions</strong>
					<span>
						Conditions: speaker, profile, window_min/max, gpu_utilization_min,
						attempt_min.
					</span>
				</div>
				<label>
					<span className={styles.visuallyHidden}>Buscar variável</span>
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Buscar variável…"
					/>
				</label>
				<div className={styles.barkPackVariableGrid}>
					{variables.map((item) => (
						<code key={item.name} title={item.when}>
							{"{"}{item.name}{"}"} · {item.type} · ex. {item.example}
						</code>
					))}
				</div>
			</section>
		</details>
	);
}
