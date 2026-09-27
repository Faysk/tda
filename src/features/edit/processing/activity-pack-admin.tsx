"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	ACTIVITY_PACK_VARIABLES,
	activityPackCatalog,
	activityPackExample,
	exportActivityPack,
	parseActivityPackJson,
	type ActivityPack,
} from "./activity-pack";
import {
	findPackConflict,
	importDisabledActivityPack,
	loadActivityPacks,
	removeActivityPack,
	setActivityPackEnabled,
} from "./activity-pack-storage";
import {
	selectActivityBark,
	type ActivityContext,
} from "./activity-barks";
import styles from "./activity-pack-admin.module.css";

type Scope = Readonly<{ profileId: string; campaignSlug: string }>;

function generationPrompt() {
	return [
		"Crie um JSON válido conforme tda_activity_pack_v1.",
		"Retorne apenas JSON, sem Markdown.",
		"Use somente eventos de sucesso permitidos e somente as variáveis listadas.",
		"Nunca inclua HTML, handlers, URLs executáveis ou campos extras.",
		"Templates devem ter IDs kebab-case estáveis e únicos dentro do pack.",
		"Quero pt-BR, humor TDA, variedade entre speaker, DevOps, RPG, GPU e meta.",
		"",
		"Variáveis: " +
			ACTIVITY_PACK_VARIABLES.map((item) => "{" + item.name + "}").join(", "),
		"",
		"Exemplo:",
		activityPackExample(),
	].join("\n");
}

function exportAll(packs: readonly ActivityPack[]) {
	const payload = JSON.stringify(
		packs.map((pack) => JSON.parse(exportActivityPack(pack))),
		null,
		2,
	);
	const url = URL.createObjectURL(
		new Blob([payload], { type: "application/json" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = "tda-activity-packs.json";
	link.click();
	URL.revokeObjectURL(url);
}

function previewContext(seq: number): ActivityContext {
	return {
		eventCode:
			seq % 2 === 0
				? "WHISPER_SEGMENT_TRANSCRIBED"
				: "QWEN_WINDOW_TRANSCRIBED",
		seq,
		eventAt: "2026-09-27T20:00:00.000Z",
		jobId: "synthetic-pack-preview",
		attempt: 1,
		sessionId: "preview",
		profileId: seq % 2 === 0 ? "whisper-detailed" : "qwen-quality",
		speaker: "Faysk",
		track: 3,
		totalTracks: 4,
		window: 205 + seq,
		segment: 40 + seq,
		audioStartSeconds: 5500,
		audioEndSeconds: 5510,
		gpuName: "RTX 4070",
		gpuUtilizationPercent: 96,
	};
}

function syntheticPreview(pack: ActivityPack): string[] {
	const prefix = pack.id + ":";
	const catalog = activityPackCatalog([{ ...pack, enabled: true }]).filter(
		(item) => item.id.startsWith(prefix),
	);
	const output: string[] = [];
	for (let seq = 1; seq <= 50; seq += 1) {
		const bark = selectActivityBark(previewContext(seq), {
			level: pack.humorLevel,
			catalog,
		});
		if (bark && !output.includes(bark.text)) output.push(bark.text);
		if (output.length >= 20) break;
	}
	return output;
}

export function ActivityPackAdmin({ scope }: Readonly<{ scope: Scope }>) {
	const [packs, setPacks] = useState<ActivityPack[]>([]);
	const [candidate, setCandidate] = useState<ActivityPack | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [query, setQuery] = useState("");

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		void loadActivityPacks(scope)
			.then((value) => {
				if (!cancelled) {
					setPacks(value);
					setError(null);
				}
			})
			.catch((cause) => {
				if (!cancelled)
					setError(
						cause instanceof Error ? cause.message : "PACK_LIBRARY_INVALID",
					);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [scope]);

	const conflict = candidate ? findPackConflict(candidate, packs) : null;
	const preview = useMemo(
		() => (candidate ? syntheticPreview(candidate) : []),
		[candidate],
	);
	const visibleVariables = ACTIVITY_PACK_VARIABLES.filter((item) =>
		(item.name + " " + item.when)
			.toLocaleLowerCase("pt-BR")
			.includes(query.trim().toLocaleLowerCase("pt-BR")),
	);

	async function read(file: File | undefined) {
		if (!file) return;
		try {
			const parsed = await parseActivityPackJson(await file.text());
			setCandidate(parsed);
			setError(null);
			setNotice(
				"Validação concluída. O pack foi carregado somente para preview e permanece desativado.",
			);
		} catch (cause) {
			setCandidate(null);
			setNotice(null);
			setError(cause instanceof Error ? cause.message : "PACK_INVALID");
		}
	}

	async function commitCandidate(replace = false) {
		if (!candidate) return;
		try {
			const next = await importDisabledActivityPack(
				scope,
				packs,
				candidate,
				{ replace },
			);
			setPacks(next);
			setCandidate(null);
			setError(null);
			setNotice(
				"Pack importado desativado. Revise a biblioteca e ative explicitamente quando quiser usá-lo.",
			);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "PACK_IMPORT_FAILED");
		}
	}

	async function toggle(pack: ActivityPack) {
		try {
			const next = await setActivityPackEnabled(
				scope,
				packs,
				pack.id,
				!pack.enabled,
			);
			setPacks(next);
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "PACK_UPDATE_FAILED");
		}
	}

	async function remove(pack: ActivityPack) {
		try {
			setPacks(await removeActivityPack(scope, packs, pack.id));
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "PACK_REMOVE_FAILED");
		}
	}

	return (
		<div className={styles.workspace}>
			<section className={styles.intro}>
				<div>
					<p className={styles.eyebrow}>Activity bark packs</p>
					<h1>Linguiça no Log</h1>
					<p>
						Pacotes locais de frases para eventos rotineiros. O arquivo é
						tratado como dado não confiável: validar vem antes de importar,
						e importar vem antes de ativar.
					</p>
				</div>
				<div className={styles.introActions}>
					<Button
						variant="tertiary"
						onClick={() =>
							void navigator.clipboard.writeText(activityPackExample())
						}
					>
						Copiar exemplo JSON
					</Button>
					<Button
						variant="tertiary"
						onClick={() =>
							void navigator.clipboard.writeText(generationPrompt())
						}
					>
						Copiar prompt para IA
					</Button>
					<Button
						variant="tertiary"
						disabled={!packs.length}
						onClick={() => exportAll(packs)}
					>
						Exportar meus packs
					</Button>
				</div>
			</section>

			{error ? (
				<p className={styles.error} role="alert">
					{error}
				</p>
			) : null}
			{notice ? (
				<p className={styles.notice} role="status">
					{notice}
				</p>
			) : null}

			<section className={styles.panel} aria-labelledby="pack-import-title">
				<div>
					<h2 id="pack-import-title">Importar e validar</h2>
					<p>
						Até 2 MB e 5.000 templates. Erro estrutural ou semântico cancela
						o arquivo inteiro.
					</p>
				</div>
				<label
					className={styles.dropzone}
					onDragOver={(event) => event.preventDefault()}
					onDrop={(event) => {
						event.preventDefault();
						void read(event.dataTransfer.files[0]);
					}}
				>
					<span>Arraste seu pack JSON aqui</span>
					<small>ou escolha um arquivo</small>
					<input
						type="file"
						accept="application/json,.json"
						onChange={(event) => void read(event.target.files?.[0])}
					/>
				</label>

				{candidate ? (
					<div className={styles.preview}>
						<div className={styles.previewHeader}>
							<div>
								<strong>{candidate.name}</strong>
								<span>
									{candidate.id} · v{candidate.version} ·{" "}
									{candidate.templates.length} templates
								</span>
							</div>
							<code>{candidate.canonicalSha256.slice(0, 16)}…</code>
						</div>
						{conflict ? (
							<p className={styles.warning}>Conflito: {conflict}</p>
						) : null}
						<div className={styles.sampleList}>
							{preview.length ? (
								preview.map((value) => <blockquote key={value}>{value}</blockquote>)
							) : (
								<p>Nenhuma frase ficou elegível no contexto sintético.</p>
							)}
						</div>
						<div className={styles.rowActions}>
							{conflict === "PACK_ALREADY_IMPORTED" ? (
								<span>Esse conteúdo já está importado.</span>
							) : conflict ? (
								<Button onClick={() => void commitCandidate(true)}>
									Substituir explicitamente
								</Button>
							) : (
								<Button onClick={() => void commitCandidate(false)}>
									Importar desativado
								</Button>
							)}
							<Button
								variant="tertiary"
								onClick={() => setCandidate(null)}
							>
								Cancelar
							</Button>
						</div>
					</div>
				) : null}
			</section>

			<section className={styles.panel} aria-labelledby="pack-library-title">
				<div>
					<h2 id="pack-library-title">Meus packs</h2>
					<p>
						Browser-local · escopo {scope.campaignSlug} · perfil atual.
					</p>
				</div>
				{loading ? (
					<p>Carregando biblioteca local…</p>
				) : packs.length ? (
					<ul className={styles.packList}>
						{packs.map((pack) => (
							<li key={pack.id}>
								<div>
									<strong>{pack.name}</strong>
									<span>
										{pack.id} · v{pack.version} · {pack.templates.length} frases
									</span>
								</div>
								<span className={styles.state}>
									{pack.enabled ? "ativo" : "pausado"}
								</span>
								<div className={styles.rowActions}>
									<Button size="sm" onClick={() => void toggle(pack)}>
										{pack.enabled ? "Pausar" : "Ativar"}
									</Button>
									<Button
										size="sm"
										variant="tertiary"
										onClick={() => void remove(pack)}
									>
										Remover
									</Button>
								</div>
							</li>
						))}
					</ul>
				) : (
					<p>Nenhum pack personalizado neste browser/perfil.</p>
				)}
			</section>

			<section className={styles.panel} aria-labelledby="pack-vars-title">
				<div>
					<h2 id="pack-vars-title">Variáveis disponíveis</h2>
					<p>
						O MVP só aceita valores que o renderer atual consegue provar de forma
						factual.
					</p>
				</div>
				<label className={styles.search}>
					<span>Buscar variável</span>
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="speaker, GPU, janela…"
					/>
				</label>
				<div className={styles.variableTable}>
					{visibleVariables.map((item) => (
						<div key={item.name}>
							<code>{"{" + item.name + "}"}</code>
							<span>{item.example}</span>
							<small>{item.when}</small>
							<button
								type="button"
								onClick={() =>
									void navigator.clipboard.writeText("{" + item.name + "}")
								}
							>
								Copiar
							</button>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
