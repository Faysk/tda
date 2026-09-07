"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/action";
import { ProcessingController } from "./controller";
import { connectionHelp, jobLabels, stageLabels } from "./presentation";
import styles from "./processing.module.css";

type Confirmation =
	| { id: string; action: "cancel" | "retry" }
	| { action: "resume" };

export function ProcessingPanel() {
	const [controller] = useState(() => new ProcessingController());
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.snapshot,
		controller.serverSnapshot,
	);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const token = useRef<HTMLInputElement>(null);
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => () => controller.disconnect(), [controller]);
	useEffect(() => {
		if (state.connection !== "connected" || state.busy) return;
		const timer = setTimeout(() => {
			if (document.visibilityState === "visible") void controller.refresh();
		}, 3000);
		const visible = () => {
			if (document.visibilityState === "visible") void controller.refresh();
		};
		document.addEventListener("visibilitychange", visible);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", visible);
		};
	}, [controller, state.connection, state.busy]);
	useEffect(() => {
		if (confirmation) dialog.current?.showModal();
		else dialog.current?.close();
	}, [confirmation]);
	const connected = state.connection === "connected";
	const label = connected
		? { preparing: "Em preparação", ready: "Pronto", paused: "Fila pausada" }[
				state.health?.lifecycle ?? "preparing"
			]
		: state.connection === "connecting"
			? "Conectando"
			: state.error === "incompatible"
				? "Versão incompatível"
				: "Serviço desconectado";
	async function confirm() {
		const choice = confirmation;
		setConfirmation(null);
		if (!choice) return;
		if (choice.action === "resume") await controller.lifecycle("resume");
		else await controller.jobAction(choice.id, choice.action);
	}
	return (
		<div className={styles.panel}>
			<section className={styles.card} aria-labelledby="local-computer">
				<div className={styles.heading}>
					<h2 id="local-computer">Computador deste navegador</h2>
					<strong role="status">{label}</strong>
				</div>
				<p>
					O site fica na cloud. O serviço e os áudios ficam neste computador. Em
					outro navegador ou dispositivo, a conexão aponta para o computador
					onde ele está aberto.
				</p>
				{state.error ? (
					<p role="alert">
						{connectionHelp[state.error]} <small>Código: {state.error}</small>
					</p>
				) : null}
				{!connected ? (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							const value = token.current?.value ?? "";
							if (token.current) token.current.value = "";
							void controller.connect(value.trim());
						}}
					>
						<label htmlFor="pair-token">
							Token de pareamento do aplicativo local
						</label>
						<div className={styles.controls}>
							<input
								ref={token}
								id="pair-token"
								type="password"
								autoComplete="off"
								spellCheck={false}
								required
								minLength={32}
								maxLength={256}
								disabled={state.busy}
								aria-describedby="pair-help"
							/>
							<Button type="submit" disabled={state.busy}>
								Conectar neste computador
							</Button>
						</div>
						<p id="pair-help" className={styles.muted}>
							Copie o token no aplicativo local. Ele fica apenas na memória
							desta aba. Recarregar exige novo pareamento; para revogá-lo,
							regenere o token no serviço. O navegador pode pedir permissão para
							acesso à rede local.
						</p>
					</form>
				) : (
					<>
						<p>
							Serviço: {state.capabilities?.device.label} · versão{" "}
							{state.health?.service_version} · API v1
						</p>
						<p className={styles.muted}>
							Identidade local: {state.capabilities?.device.id}
						</p>
						<div className={styles.controls}>
							<Button
								disabled={state.busy}
								onClick={() => void controller.refresh()}
							>
								Atualizar estado
							</Button>
							<Button
								onClick={() => {
									setConfirmation(null);
									controller.disconnect();
								}}
							>
								Desconectar esta aba
							</Button>
							{state.health?.lifecycle === "paused" ? (
								<Button
									disabled={state.busy}
									onClick={() => setConfirmation({ action: "resume" })}
								>
									Retomar fila
								</Button>
							) : state.health?.lifecycle === "ready" ? (
								<Button
									disabled={state.busy}
									onClick={() => void controller.lifecycle("pause")}
								>
									Pausar novas execuções
								</Button>
							) : null}
						</div>
						<p className={styles.muted}>
							Desconectar a aba não para trabalhos. Pausar a fila não interrompe
							o trabalho ativo.
						</p>
					</>
				)}
			</section>
			<section className={styles.card} aria-labelledby="local-queue">
				<div className={styles.heading}>
					<h2 id="local-queue">Fila local</h2>
					<span>
						{connected
							? `${state.jobs.length} trabalhos`
							: "Estado indisponível"}
					</span>
				</div>
				{state.checkedAt ? (
					<p className={styles.muted}>
						Última consulta:{" "}
						<time dateTime={state.checkedAt}>
							{new Date(state.checkedAt).toLocaleTimeString("pt-BR")}
						</time>
						. Progresso informado pelo serviço em cada etapa.
					</p>
				) : null}
				{connected && state.jobs.length === 0 ? (
					<p>Nenhum trabalho nesta fila.</p>
				) : null}
				{!connected ? (
					<p>
						Conecte o serviço para consultar a fila persistida. A ausência de
						conexão não significa que o processamento parou.
					</p>
				) : null}
				<ul className={styles.jobs}>
					{state.jobs.map((job) => (
						<li key={job.id} className={styles.job}>
							<div className={styles.heading}>
								<h3>
									{job.kind === "synthetic.fixture"
										? "Ensaio sintético"
										: job.kind}
								</h3>
								<strong>{jobLabels[job.status]}</strong>
							</div>
							<p className={styles.muted}>Trabalho {job.id}</p>
							<p>Etapa: {stageLabels[job.stage] ?? job.stage}</p>
							{job.progress ? (
								<>
									<progress
										aria-label={`Progresso do trabalho ${job.id}`}
										value={job.progress.completed}
										max={job.progress.total}
									/>
									<p>
										{job.progress.completed} de {job.progress.total}{" "}
										{job.progress.unit === "items"
											? "itens"
											: job.progress.unit}
									</p>
								</>
							) : (
								<p>Sem medida de progresso nesta etapa.</p>
							)}
							{job.error ? (
								<p>
									Falha: {job.error.code}.{" "}
									{job.error.recoverable
										? "É possível repetir este trabalho."
										: "Consulte o diagnóstico no aplicativo local."}
								</p>
							) : null}
							<div className={styles.controls}>
								{["queued", "running"].includes(job.status) ? (
									<Button
										disabled={state.busy}
										onClick={() =>
											setConfirmation({ id: job.id, action: "cancel" })
										}
									>
										Cancelar trabalho
									</Button>
								) : null}
								{["failed", "interrupted"].includes(job.status) &&
								job.error?.recoverable ? (
									<Button
										disabled={state.busy}
										onClick={() =>
											setConfirmation({ id: job.id, action: "retry" })
										}
									>
										Repetir trabalho
									</Button>
								) : null}
								{job.status === "succeeded" && job.result_available ? (
									<Button
										disabled={state.busy}
										onClick={() => void controller.result(job.id)}
									>
										Consultar resultado local
									</Button>
								) : null}
							</div>
						</li>
					))}
				</ul>
			</section>
			<section className={styles.card} aria-labelledby="local-sync">
				<h2 id="local-sync">Resultados e revisão no Edit</h2>
				<p>
					<strong>Sincronização não configurada.</strong> Concluir localmente
					não significa enviar ou publicar. A importação de transcrições no Edit
					aguarda um consumidor autorizado com confirmação de recebimento.
				</p>
				{state.result ? (
					<div role="status">
						<p>
							Resultado local disponível para o trabalho {state.result.jobId}.
						</p>
						<dl>
							<dt>Campanha</dt>
							<dd>{state.result.campaignId}</dd>
							<dt>Sessão</dt>
							<dd>{state.result.sessionId}</dd>
							<dt>Origem</dt>
							<dd>{state.result.sourceId}</dd>
							<dt>Identidade do pacote</dt>
							<dd>{state.result.publicationId}</dd>
						</dl>
						<p>
							Pacote de publicação sem áudio e sem transcrição completa. Nenhum
							recibo cloud recebido.
						</p>
					</div>
				) : null}
			</section>
			{connected &&
			state.capabilities?.capabilities.includes("synthetic.fixture") ? (
				<section className={styles.card} aria-labelledby="synthetic-test">
					<h2 id="synthetic-test">Ensaio de integração</h2>
					<p>
						Cria um trabalho sintético no serviço conectado. Não usa áudio,
						modelo de transcrição ou GPU. Os resultados de demonstração não são
						conteúdo da campanha.
					</p>
					{state.uncertainSubmission ? (
						<p role="alert">
							A resposta do envio anterior não foi confirmada. Consulte a fila;
							repetir o envio nesta aba reutiliza a mesma chave para evitar
							duplicação.
						</p>
					) : null}
					<Button
						disabled={state.busy || state.health?.lifecycle !== "ready"}
						onClick={() => void controller.synthetic()}
					>
						{state.uncertainSubmission
							? "Consultar ou repetir envio sintético"
							: "Executar ensaio sintético"}
					</Button>
				</section>
			) : null}
			<dialog
				ref={dialog}
				className={styles.dialog}
				aria-labelledby="confirm-title"
				onCancel={() => setConfirmation(null)}
			>
				<h2 id="confirm-title">
					{confirmation?.action === "cancel"
						? "Cancelar este trabalho?"
						: confirmation?.action === "retry"
							? "Repetir este trabalho?"
							: "Retomar a fila?"}
				</h2>
				{confirmation && "id" in confirmation ? (
					<p>Trabalho {confirmation.id}</p>
				) : null}
				<p>
					{confirmation?.action === "cancel"
						? "O serviço receberá um pedido de cancelamento. Os arquivos de origem são preservados. Aguarde a confirmação do estado na fila."
						: confirmation?.action === "retry"
							? "Uma nova tentativa pode repetir etapas. Esta versão não promete retomar do ponto exato da interrupção."
							: "O serviço voltará a iniciar os trabalhos que aguardam na fila deste computador."}
				</p>
				<div className={styles.controls}>
					<Button onClick={() => setConfirmation(null)}>Voltar</Button>
					<Button onClick={() => void confirm()}>Confirmar</Button>
				</div>
			</dialog>
		</div>
	);
}
