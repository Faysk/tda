"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LocalReview, LocalReviewSegment } from "@/features/edit/processing/protocol";
import {
	decodeTranscriptMarkdownBytes,
	parseTranscriptMarkdownV1,
	renderTranscriptMarkdownV1,
	TranscriptMarkdownError,
	TRANSCRIPT_MARKDOWN_MAX_BYTES,
	type TranscriptMarkdownBase,
	type TranscriptMarkdownImport,
	type TranscriptMarkdownSegment,
} from "./markdown-contract";
import {
	applyLocalReviewMarkdownImport,
	localReviewMarkdownBase,
	localReviewMarkdownSegments,
} from "./local-review-markdown";

type Preview = Readonly<{
	fileName: string;
	baseKey: string;
	result: TranscriptMarkdownImport;
}>;

function message(error: unknown): string {
	if (!(error instanceof TranscriptMarkdownError))
		return "Não foi possível validar este arquivo. Nada foi alterado.";
	return {
		FILE_TOO_LARGE: "O Markdown excede 32 MiB. Nada foi carregado.",
		UTF8_INVALID: "O arquivo não é UTF-8 válido.",
		FRONTMATTER_INVALID: "O cabeçalho TDA está ausente ou inválido.",
		SCHEMA_UNSUPPORTED: "Esta versão do TDA Transcript Markdown não é suportada.",
		BASE_MISMATCH: "O arquivo pertence a outra sessão, run ou revisão-base.",
		STRUCTURE_HASH_MISMATCH: "A estrutura protegida do Markdown não confere.",
		SEGMENT_COUNT_INVALID: "A quantidade de falas está fora do contrato.",
		MARKER_INVALID: "Um marcador estrutural tda:segment foi alterado.",
		MARKER_DUPLICATE: "Há uma fala estrutural duplicada no arquivo.",
		MARKER_UNKNOWN: "O arquivo contém uma fala que não pertence a esta revisão.",
		MARKER_MISSING: "Uma ou mais falas estruturais foram removidas.",
		SEGMENT_REORDERED: "A ordem estrutural das falas foi alterada.",
		TIMING_CHANGED: "Um timestamp estrutural foi alterado.",
		VISIBLE_TIMESTAMP_CHANGED: "Um timestamp visível foi alterado.",
		SPEAKER_INVALID: "Um nome de participante é inválido ou excede o limite.",
		TEXT_INVALID: "Um texto de fala é inválido, vazio ou excede o limite.",
	}[error.code];
}

function filePart(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 80) || "sessao";
}

function excerpt(value: string): string {
	const single = value.replace(/\s+/gu, " ").trim();
	return single.length > 120 ? single.slice(0, 117) + "…" : single;
}

export function TranscriptMarkdownRoundTrip({
	base,
	segments,
	title,
	fileIdentity,
	dirty,
	disabled,
	onApply,
}: Readonly<{
	base: TranscriptMarkdownBase;
	segments: readonly TranscriptMarkdownSegment[];
	title: string;
	fileIdentity: string;
	dirty: boolean;
	disabled: boolean;
	onApply: (result: TranscriptMarkdownImport) => void;
}>) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [preview, setPreview] = useState<Preview | null>(null);
	const baseKey = JSON.stringify(base);

	useEffect(() => {
		void baseKey;
		setPreview(null);
		setError(null);
	}, [baseKey]);

	async function exportMarkdown() {
		if (busy || disabled) return;
		setBusy(true);
		setError(null);
		try {
			const markdown = await renderTranscriptMarkdownV1({ base, segments, title });
			const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = filePart(fileIdentity) + "-transcricao-tda-v1.md";
			anchor.rel = "noopener";
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(url);
		} catch (cause) {
			setError(message(cause));
		} finally {
			setBusy(false);
		}
	}

	async function load(file: File | undefined) {
		if (!file || busy || disabled || dirty) return;
		setBusy(true);
		setError(null);
		setPreview(null);
		try {
			if (file.size > TRANSCRIPT_MARKDOWN_MAX_BYTES)
				throw new TranscriptMarkdownError("FILE_TOO_LARGE");
			const bytes = new Uint8Array(await file.arrayBuffer());
			const text = decodeTranscriptMarkdownBytes(bytes);
			const result = await parseTranscriptMarkdownV1({
				text,
				expectedBase: base,
				expectedSegments: segments,
			});
			setPreview({ fileName: file.name, baseKey, result });
		} catch (cause) {
			setError(message(cause));
		} finally {
			setBusy(false);
			if (inputRef.current) inputRef.current.value = "";
		}
	}

	function apply() {
		if (!preview || preview.baseKey !== baseKey || preview.result.changedSegments === 0) {
			if (preview?.baseKey !== baseKey)
				setError("A revisão-base mudou depois da validação. Importe o arquivo novamente.");
			return;
		}
		onApply(preview.result);
		setPreview(null);
		setError(null);
	}

	return (
		<details data-transcript-markdown-roundtrip="true">
			<summary>Markdown para revisão externa</summary>
			<p>
				Exporte uma cópia privada, corrija apenas participante e texto e importe de volta.
				IDs, timestamps, ordem e quantidade de falas são verificados antes de qualquer alteração.
			</p>
			<div>
				<Button type="button" size="sm" variant="tertiary" disabled={disabled || busy} onClick={() => void exportMarkdown()}>
					{busy ? "Validando…" : "Exportar Markdown TDA v1"}
				</Button>
				<input
					ref={inputRef}
					type="file"
					accept=".md,text/markdown,text/plain"
					hidden
					onChange={(event) => void load(event.currentTarget.files?.[0])}
				/>
				<Button type="button" size="sm" variant="tertiary" disabled={disabled || busy || dirty} onClick={() => inputRef.current?.click()}>
					Importar revisão (.md)
				</Button>
			</div>
			{dirty ? <p role="status">Salve ou descarte as alterações locais antes de importar um arquivo externo.</p> : null}
			{error ? <p role="alert">{error}</p> : null}
			{preview ? (
				<section aria-label="Prévia da importação Markdown" data-transcript-markdown-preview="true">
					<h3>Prévia obrigatória</h3>
					<p>
						<strong>{preview.fileName}</strong> · {segments.length.toLocaleString("pt-BR")} falas reconhecidas ·{" "}
						{preview.result.changedSegments.toLocaleString("pt-BR")} alteradas ·{" "}
						{preview.result.speakerChanges.toLocaleString("pt-BR")} nomes ·{" "}
						{preview.result.textChanges.toLocaleString("pt-BR")} textos ·{" "}
						{preview.result.unchangedSegments.toLocaleString("pt-BR")} sem mudança.
					</p>
					{preview.result.changes.length ? (
						<ul>
							{preview.result.changes.slice(0, 20).map((change) => (
								<li key={change.id}>
									<strong>{change.afterSpeaker}</strong> · {Math.floor(change.startMs / 1000)}s ·{" "}
									{change.speakerChanged ? "participante alterado" : "participante igual"}
									{change.textChanged ? " · texto: " + excerpt(change.afterText) : ""}
								</li>
							))}
						</ul>
					) : (
						<p>Nenhuma mudança editorial detectada. Nenhuma nova revisão será criada.</p>
					)}
					{preview.result.changes.length > 20 ? (
						<p>Mostrando 20 de {preview.result.changes.length.toLocaleString("pt-BR")} mudanças.</p>
					) : null}
					<div>
						<Button type="button" size="sm" variant="tertiary" onClick={() => setPreview(null)}>Cancelar</Button>
						<Button type="button" size="sm" variant="primary" disabled={preview.result.changedSegments === 0 || disabled} onClick={apply}>
							Aplicar à working copy
						</Button>
					</div>
					<small>
						A aplicação ainda não salva. Revise a working copy e use Salvar alterações; o CAS do Companion recusará uma base que tenha ficado stale.
					</small>
				</section>
			) : null}
		</details>
	);
}

export function LocalReviewMarkdownRoundTrip({
	baseline,
	segments,
	dirty,
	disabled,
	onApply,
}: Readonly<{
	baseline: LocalReview;
	segments: readonly LocalReviewSegment[];
	dirty: boolean;
	disabled: boolean;
	onApply: (segments: readonly LocalReviewSegment[]) => void;
}>) {
	const markdownSegments = localReviewMarkdownSegments({ segments });
	return (
		<TranscriptMarkdownRoundTrip
			base={localReviewMarkdownBase(baseline)}
			segments={markdownSegments}
			title={baseline.publicationTarget?.sourceSessionId ?? "Revisão " + baseline.lineage.profileId}
			fileIdentity={baseline.publicationTarget?.sourceSessionId ?? baseline.runId.slice(0, 24)}
			dirty={dirty}
			disabled={disabled}
			onApply={(result) => onApply(applyLocalReviewMarkdownImport(segments, result))}
		/>
	);
}
