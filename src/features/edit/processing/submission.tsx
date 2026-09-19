"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	LocalBridge,
	localBridgePaired,
	subscribeLocalBridgePairing,
} from "./bridge";
import {
	BridgeError,
	type Capabilities,
	type CraigSource,
	type PreparationStatus,
	type TranscriptionProfileId,
} from "./protocol";
import styles from "./submission.module.css";

const profileLabels: Record<TranscriptionProfileId, string> = {
	"whisper-turbo": "Whisper Turbo",
	"whisper-detailed": "Whisper Detalhado",
	"qwen-fast": "Qwen Fast",
	"qwen-quality": "Qwen Quality",
};

function messageFor(code: string): string {
	return {
		unauthorized: "A sessão local expirou. O TDA tentará reconectar ao Companion.",
		forbidden: "O Companion recusou esta origem.",
		conflict: "O Companion recusou a operação no estado atual.",
		timeout: "A operação local excedeu o tempo esperado. Confira a fila antes de repetir.",
		unreachable: "Não foi possível alcançar o Companion local.",
		invalid_response: "O Companion respondeu com um contrato inválido.",
		incompatible: "A versão do Companion não suporta este fluxo. Atualize o aplicativo local.",
		service_error: "O Companion encontrou uma falha local.",
	}[code] ?? "Falha local inesperada.";
}

function localOperationMessage(code: string | null): string {
	if (!code) return "A operação local não foi concluída.";
	return {
		TRANSCRIPTION_PREPARATION_ALREADY_RUNNING:
			"Já existe outra preparação em andamento neste computador.",
		TRANSCRIPTION_PREPARATION_CANCELLED:
			"A preparação local foi cancelada antes de terminar.",
		TRANSCRIPTION_PREPARATION_BLOCKED_BY_ACTIVE_JOB:
			"Já existe um trabalho local na fila ou em execução. Aguarde antes de preparar outro perfil.",
		TRANSCRIPTION_PREPARATION_BLOCKED_BY_RUNNING_JOB:
			"Espere o trabalho atual terminar antes de preparar outro perfil.",
		TRANSCRIPTION_WORK_ALREADY_ACTIVE:
			"Já existe uma transcrição equivalente na fila ou em execução.",
		CRAIG_STAGING_REPAIR_BLOCKED_BY_RUNNING_JOB:
			"Essa fonte está em uso pelo processamento ou pela preparação local. Aguarde terminar antes de reimportar o ZIP.",
		CRAIG_STAGING_REPAIR_FAILED:
			"O Companion tentou reparar a cópia local da sessão, mas não conseguiu concluir a troca segura.",
		CRAIG_STAGING_EXISTING_INVALID:
			"A cópia local dessa sessão está inconsistente. Reenvie o ZIP original quando a fonte não estiver em uso.",
		CRAIG_MANIFEST_TRACK_HASH_MISMATCH:
			"Uma faixa da cópia local foi alterada. Reenvie o ZIP original para reparar a sessão.",
		CRAIG_MANIFEST_TRACK_SIZE_MISMATCH:
			"Uma faixa da cópia local mudou de tamanho. Reenvie o ZIP original para reparar a sessão.",
		CRAIG_UPLOAD_STORAGE_FAILED:
			"O Companion não conseguiu gravar o ZIP no armazenamento local.",
		CRAIG_UPLOAD_SIZE_LIMIT:
			"O ZIP ultrapassa o limite aceito pelo Companion.",
		CRAIG_ZIP_REQUIRED:
			"Escolha um arquivo ZIP exportado pelo Craig.",
		QWEN_PHYSICAL_ACCEPTANCE_REQUIRED:
			"O Qwen precisa ser preparado e validado novamente nesta GPU antes de entrar na fila.",
		WHISPER_MODEL_PREPARATION_REQUIRED:
			"O modelo Whisper precisa ser preparado novamente antes de entrar na fila.",
		QWEN_CUDA_UNAVAILABLE:
			"O Qwen não encontrou CUDA disponível nesta máquina.",
		QWEN_CUDA_DRIVER_INCOMPATIBLE:
			"O driver NVIDIA não consegue executar o runtime CUDA exigido pelo Qwen.",
		QWEN_CUDA_EXECUTION_FAILED:
			"A GPU foi encontrada, mas uma operação CUDA real falhou.",
		QWEN_ASR_GPU_MEMORY_EXHAUSTED:
			"O Qwen ficou sem VRAM durante a validação local.",
		QWEN_ACCEPTANCE_AUDIO_TOO_SHORT:
			"Nenhuma faixa do ZIP possui áudio útil suficiente para validar o Qwen.",
		QWEN_ACCEPTANCE_NO_SPEECH_RECOGNIZED:
			"A amostra local escolhida não teve fala suficiente para validar o Qwen.",
		QWEN_MODEL_DOWNLOAD_FAILED:
			"Não foi possível baixar o modelo Qwen.",
		QWEN_RUNTIME_UNAVAILABLE:
			"O runtime Qwen compatível ainda não está disponível.",
		WHISPER_RUNTIME_UNAVAILABLE:
			"O runtime Whisper compatível ainda não está disponível.",
		WHISPER_MODEL_DOWNLOAD_FAILED:
			"Não foi possível baixar o modelo Whisper.",
		WHISPER_MODEL_PREPARATION_TIMEOUT:
			"A preparação do modelo Whisper excedeu o limite de tempo.",
	}[code] ?? `Operação local não concluída · ${code}`;
}

type PendingSubmission = {
	key: string;
	signature: string;
};

export function ProcessingSubmission() {
	const paired = useSyncExternalStore(
		subscribeLocalBridgePairing,
		localBridgePaired,
		() => false,
	);
	const [bridge] = useState(() => new LocalBridge());
	const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
	const [profile, setProfile] = useState<TranscriptionProfileId | "">("");
	const [sessionId, setSessionId] = useState("");
	const [context, setContext] = useState("");
	const [glossary, setGlossary] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [source, setSource] = useState<CraigSource | null>(null);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [capabilityError, setCapabilityError] = useState<string | null>(null);
	const request = useRef<AbortController | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const pending = useRef<PendingSubmission | null>(null);

	useEffect(() => {
		return () => request.current?.abort();
	}, []);

	useEffect(() => {
		if (!paired) {
			request.current?.abort();
			setCapabilities(null);
			setProfile("");
			setCapabilityError(null);
			return;
		}

		const controller = new AbortController();
		let reading = false;
		let stopped = false;
		const refreshCapabilities = async () => {
			if (reading || stopped || controller.signal.aborted) return;
			reading = true;
			try {
				const value = await bridge.capabilities(controller.signal);
				if (stopped || controller.signal.aborted) return;
				setCapabilities(value);
				const choices = value.transcription.catalog.length
					? value.transcription.catalog.map((item) => item.id)
					: value.transcription.profiles;
				setProfile((current) =>
					current && choices.includes(current)
						? current
						: choices.includes("qwen-quality")
							? "qwen-quality"
							: (choices[0] ?? ""),
				);
				setCapabilityError(null);
			} catch (cause) {
				if (!stopped && !controller.signal.aborted) {
					setCapabilityError(messageFor(cause instanceof BridgeError ? cause.code : "service_error"));
				}
			} finally {
				reading = false;
			}
		};

		void refreshCapabilities();
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void refreshCapabilities();
		}, 3000);
		const visible = () => {
			if (document.visibilityState === "visible") void refreshCapabilities();
		};
		document.addEventListener("visibilitychange", visible);
		return () => {
			stopped = true;
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", visible);
			controller.abort();
		};
	}, [bridge, paired]);

	const availableProfiles = useMemo(
		() =>
			capabilities?.transcription.catalog.length
				? capabilities.transcription.catalog
				: (capabilities?.transcription.profiles ?? []).map((id) => ({
						id,
						engine: id.startsWith("qwen-")
							? ("qwen3" as const)
							: ("whisper" as const),
						ready: true,
						preparationRequired: false,
						reason: null,
					})),
		[capabilities],
	);

	const canSubmit = useMemo(
		() =>
			Boolean(
				capabilities &&
					availableProfiles.length > 0 &&
					(capabilities.capabilities.includes("transcription.craig") ||
						capabilities.capabilities.includes("transcription.prepare")),
			),
		[availableProfiles, capabilities],
	);

	if (!paired) return null;

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !file || !profile || !canSubmit) return;
		if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) {
			setError("Use um ID de sessão com letras, números, _ ou -, até 128 caracteres.");
			return;
		}
		if (!file.name.toLowerCase().endsWith(".zip") || file.size <= 0) {
			setError("Escolha um ZIP válido exportado pelo Craig.");
			return;
		}

		const controller = new AbortController();
		request.current?.abort();
		request.current = controller;
		setBusy(true);
		setError(null);
		setStatus("Enviando o ZIP diretamente para o Companion local…");
		try {
			const staged = await bridge.craigSource(file, controller.signal);
			setSource(staged);
			setStatus(
				staged.reused
					? `Fonte local já verificada · ${staged.trackCount} tracks. Enfileirando…`
					: `ZIP verificado · ${staged.trackCount} tracks. Enfileirando…`,
			);

			const selectedProfile = availableProfiles.find((item) => item.id === profile);
			if (!selectedProfile) {
				setError("O perfil selecionado não está disponível neste Companion.");
				return;
			}
			if (!selectedProfile.ready) {
				setStatus("Preparando o perfil no Agent local…");
				let preparation: PreparationStatus = await bridge.prepareProfile(
					staged.sourceId,
					profile,
					controller.signal,
				);
				const preparationDeadline = Date.now() + 2 * 60 * 60 * 1000;
				while (preparation.state === "running") {
					setStatus(
						`${preparation.title} ${preparation.detail} · ${Math.round(preparation.elapsedSeconds)} s`,
					);
					if (Date.now() >= preparationDeadline) {
						setError("A preparação excedeu o limite de 2 horas.");
						return;
					}
					await new Promise((resolve) => window.setTimeout(resolve, 1500));
					if (controller.signal.aborted) return;
					preparation = await bridge.preparation(controller.signal);
				}
				if (preparation.state !== "completed") {
					setError(localOperationMessage(preparation.errorCode));
					return;
				}
				setStatus("Perfil preparado e validado. Confirmando capacidade do Agent…");
				const refreshed = await bridge.capabilities(controller.signal);
				setCapabilities(refreshed);
				if (!refreshed.transcription.profiles.includes(profile)) {
					setError("O Agent concluiu a preparação, mas ainda não anunciou o perfil como pronto.");
					return;
				}
			}

			const signature = JSON.stringify([
				CAMPAIGN_SLUG,
				sessionId,
				staged.sourceId,
				profile,
				glossary,
				context,
			]);
			if (!pending.current || pending.current.signature !== signature) {
				pending.current = { key: crypto.randomUUID(), signature };
			}

			const job = await bridge.transcription(
				{
					campaignId: CAMPAIGN_SLUG,
					sessionId,
					sourceId: staged.sourceId,
					profileId: profile,
					glossary,
					context,
				},
				pending.current.key,
				controller.signal,
			);
			pending.current = null;
			setStatus(`Trabalho ${job.id.slice(0, 8)}… entrou na fila local.`);
			setFile(null);
			if (fileInput.current) fileInput.current.value = "";
		} catch (cause) {
			if (cause instanceof BridgeError) {
				setError(
					cause.serverCode
						? localOperationMessage(cause.serverCode)
						: messageFor(cause.code),
				);
			} else {
				setError(messageFor("service_error"));
			}
			setStatus(
				pending.current
					? "A tentativa ficou ambígua; repetir com os mesmos dados reutiliza a mesma chave idempotente."
					: null,
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className={styles.card} aria-labelledby="new-local-transcription">
			<div className={styles.heading}>
				<div>
					<span>Processamento real</span>
					<h2 id="new-local-transcription">Nova transcrição Craig</h2>
				</div>
				<small>ZIP → loopback → GPU local</small>
			</div>

			{!capabilities ? (
				<p className={styles.notice} role="status">
					Lendo os perfis disponíveis no Companion…
				</p>
			) : !canSubmit ? (
				<p className={styles.notice} role="status">
					Este Companion não anunciou um fluxo de transcrição/preparação compatível. Atualize o aplicativo local.
				</p>
			) : (
				<form className={styles.form} onSubmit={submit}>
					<label>
						<span>ID da sessão</span>
						<input
							value={sessionId}
							onChange={(event) => setSessionId(event.target.value.trim())}
							pattern="[A-Za-z0-9_-]{1,128}"
							maxLength={128}
							required
							disabled={busy}
							placeholder="sessao-42"
						/>
					</label>
					<label>
						<span>Perfil</span>
						<select
							value={profile}
							onChange={(event) => setProfile(event.target.value as TranscriptionProfileId)}
							disabled={busy}
							required
						>
							{availableProfiles.map((item) => (
								<option key={item.id} value={item.id}>
									{profileLabels[item.id]}{item.ready ? "" : " · preparar no primeiro uso"}
								</option>
							))}
						</select>
					</label>
					<label className={styles.fileField}>
						<span>Export do Craig</span>
						<input
							ref={fileInput}
							type="file"
							accept=".zip,application/zip"
							required
							disabled={busy}
							onChange={(event) => {
								setFile(event.target.files?.[0] ?? null);
								setSource(null);
								setStatus(null);
								setError(null);
							}}
						/>
					</label>
					<label className={styles.wide}>
						<span>Contexto opcional</span>
						<textarea
							value={context}
							onChange={(event) => setContext(event.target.value.slice(0, 1200))}
							maxLength={1200}
							disabled={busy}
							placeholder="Contexto curto da sessão/campanha para reconhecimento."
						/>
					</label>
					<label className={styles.wide}>
						<span>Glossário opcional</span>
						<textarea
							value={glossary}
							onChange={(event) => setGlossary(event.target.value.slice(0, 1200))}
							maxLength={1200}
							disabled={busy}
							placeholder="Personagens, NPCs, lugares e termos difíceis."
						/>
					</label>
					{profile && !availableProfiles.find((item) => item.id === profile)?.ready ? (
						<p className={styles.notice} role="status">
							Primeiro uso: runtime, modelo e validação local da GPU serão preparados automaticamente antes de criar o job.
						</p>
					) : null}
					<div className={styles.actions}>
						<Button type="submit" variant="primary" disabled={busy || !file || !profile}>
							{busy ? "Preparando localmente…" : "Adicionar à fila local"}
						</Button>
						<span>O áudio não é enviado para o cloud.</span>
					</div>
				</form>
			)}

			{source ? (
				<p className={styles.source}>
					Fonte {source.sourceId.slice(0, 18)}… · {source.trackCount} tracks · {(source.sizeBytes / 1024 ** 2).toFixed(1)} MB
				</p>
			) : null}
			{status ? <p className={styles.status} role="status">{status}</p> : null}
			{capabilityError ? <p className={styles.error} role="alert">{capabilityError}</p> : null}
			{error ? <p className={styles.error} role="alert">{error}</p> : null}
		</section>
	);
}
