import { useMemo, useRef, useState } from "react";
import { Button, Select } from "@/components/ui";
import { isReviewStringV1 } from "../../transcript-review/text-contract";
import type { LocalReviewSegment } from "./protocol";
import { participantGroups, previewParticipantRename, type ParticipantRename } from "./participant-rename";
import styles from "./local-review.module.css";

export function ParticipantManager({ segments, disabled, onApply }: Readonly<{
	segments: readonly LocalReviewSegment[];
	disabled: boolean;
	onApply: (intent: ParticipantRename) => void;
}>) {
	const groups = useMemo(() => participantGroups(segments), [segments]);
	const [selected, setSelected] = useState("");
	const [name, setName] = useState("");
	const [preview, setPreview] = useState<ParticipantRename | null>(null);
	const [message, setMessage] = useState("");
	const selectRoot = useRef<HTMLDivElement>(null);
	const group = groups.find((item) => item.key === selected);
	const preserved = group ? segments.filter((segment) => segment.trackNumber === group.trackNumber && segment.speaker !== group.speaker) : [];
	function cancel() {
		setPreview(null);
		setName("");
		selectRoot.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')?.focus({ preventScroll: true });
	}
	return <details className={styles.notice}>
		<summary>Gerenciar participantes · {new Set(groups.map((item) => item.trackNumber)).size} tracks</summary>
		<div className={styles.participantManager}>
			<div ref={selectRoot}>Participante de origem
				<Select
					value={selected}
					disabled={disabled}
					options={[
						{ value: "", label: "Selecione uma track e um nome" },
						...groups.map((item) => ({
							value: item.key,
							label: `Track ${item.trackNumber} · ${item.speaker} · ${item.count} falas`,
						})),
					]}
					onChange={(value) => { setSelected(value); setPreview(null); setMessage(""); }}
					ariaLabel="Participante de origem"
					compact
				/>
			</div>
			<label>Novo nome
				<input value={name} disabled={disabled} aria-invalid={name !== "" && !isReviewStringV1(name, "speaker")} onChange={(event) => { setName(event.target.value); setPreview(null); }} />
			</label>
			<p>Somente falas da track e do nome selecionados serão alteradas. Salvar revisão continua sendo necessário.</p>
			{group ? <p aria-live="polite">{group.count} falas serão alteradas; {preserved.length} com nomes diferentes serão preservadas.</p> : null}
			{preserved.length ? <details><summary>Ver nomes preservados</summary><ul>{participantGroups(preserved).map((item) => <li key={item.key}>{item.speaker} · {item.count} falas</li>)}</ul></details> : null}
			<Button type="button" variant="secondary" disabled={disabled || !group || !isReviewStringV1(name, "speaker") || name === group.speaker} onClick={() => { if (group) setPreview(previewParticipantRename(segments, group.trackNumber, group.speaker, name)); }}>Revisar renomeio</Button>
			{preview ? <fieldset><legend>Confirmar renomeio</legend>
				<p>Track {preview.trackNumber}: {preview.expectedSpeaker} → {preview.newSpeaker}. Afeta {preview.identities.length} falas.</p>
				<Button type="button" disabled={disabled} onClick={() => {
					const current = previewParticipantRename(segments, preview.trackNumber, preview.expectedSpeaker, preview.newSpeaker);
					if (JSON.stringify(current.identities) !== JSON.stringify(preview.identities)) { setPreview(current); setMessage("O conjunto mudou. Confira a nova contagem antes de aplicar."); return; }
					onApply(preview);
					setSelected(JSON.stringify([preview.trackNumber, preview.newSpeaker]));
					setMessage(`${preview.identities.length} falas alteradas no draft. Salve a revisão para persistir.`);
					cancel();
				}}>Aplicar ao draft</Button>
				<Button type="button" variant="tertiary" onClick={cancel}>Cancelar renomeio</Button>
			</fieldset> : null}
			{message ? <p role="status">{message}</p> : null}
		</div>
	</details>;
}
