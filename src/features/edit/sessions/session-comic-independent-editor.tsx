"use client";

import { useState } from "react";
import { SessionComicEditor } from "./session-comic-editor";
import { saveIndependentSessionComicDraftAction } from "./session-comic-draft-actions";
import { publishIndependentSessionComicAction } from "./session-comic-independent-publication-actions";
import type { SessionComicDraftPage } from "./session-comic-model";
import { independentComicEditorState } from "./session-comic-independent-editor-state";

type Props = Readonly<{
  sessionId: string;
  editorialPublicationId: string;
  initialRevision: number;
  initialPages: readonly SessionComicDraftPage[];
  initialComicPublicationId: string | null;
  initialPublishedDraftRevision: number;
  editable: boolean;
  publishable: boolean;
}>;

export function IndependentSessionComicEditor({
  sessionId, editorialPublicationId, initialRevision, initialPages,
  initialComicPublicationId, initialPublishedDraftRevision, editable, publishable,
}: Props) {
  const [pages, setPages] = useState<readonly SessionComicDraftPage[]>(initialPages);
  const [revision, setRevision] = useState(initialRevision);
  const [savedPages, setSavedPages] = useState<readonly SessionComicDraftPage[]>(initialPages);
  const [comicPublicationId, setComicPublicationId] = useState(initialComicPublicationId);
  const [publishedRevision, setPublishedRevision] = useState(initialPublishedDraftRevision);
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { dirty, ready, canSave, canPublish } = independentComicEditorState({
    pages, savedPages, revision, publishedRevision, editable, publishable, busy, uploadBusy,
  });

  async function save() {
    if (!canSave) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await saveIndependentSessionComicDraftAction({
        sessionId, expectedRevision: revision, pages,
      });
      if (!result.ok) { setError("Não foi possível guardar a HQ: " + result.reason); return; }
      setRevision(result.draft.revision);
      setPages(result.draft.pages);
      setSavedPages(result.draft.pages);
      setMessage("Rascunho de HQ guardado. O resumo publicado não foi alterado.");
    } catch { setError("Falha de comunicação ao guardar a HQ. Tente novamente."); } finally { setBusy(false); }
  }

  async function publish() {
    if (!canPublish) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await publishIndependentSessionComicAction({
        sessionId, expectedEditorialPublicationId: editorialPublicationId,
        expectedPreviousComicId: comicPublicationId,
        expectedDraftRevision: revision, operationId: crypto.randomUUID(),
      });
      if (!result.ok) { setError("Não foi possível publicar a HQ: " + result.reason); return; }
      setComicPublicationId(result.receipt.publicationId);
      setPublishedRevision(revision);
      setMessage("HQ publicada na versão " + result.receipt.version + ". O resumo permaneceu intacto.");
    } catch { setError("Falha de comunicação ao publicar a HQ. Atualize a sessão antes de tentar novamente."); } finally { setBusy(false); }
  }

  return (
    <section aria-label="HQ independente da sessão">
      <h2>HQ da sessão</h2>
      <p>O resumo desta sessão já foi publicado. Pode adicionar a HQ sem preparar ou alterar a transcrição.</p>
      <SessionComicEditor sessionId={sessionId} pages={pages}
        editable={editable && !busy} onChange={setPages} onBusyChange={setUploadBusy} />
      {dirty ? <p role="status">Existem alterações ainda não guardadas.</p> : null}
      {!ready && pages.length > 0 ? <p>Adicione uma descrição acessível a todas as páginas antes de publicar.</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1rem" }}>
        <button type="button" onClick={() => void save()}
          disabled={!canSave}>Guardar rascunho HQ</button>
        {publishable && ready && revision > publishedRevision ? (
          <button type="button" onClick={() => void publish()} disabled={!canPublish}>
            Publicar HQ
          </button>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
