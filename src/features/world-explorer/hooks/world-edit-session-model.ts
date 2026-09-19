export function worldPublishFailureMessage(reason: string): string {
	switch (reason) {
		case "unauthenticated":
			return "A publicação não aconteceu: sua sessão expirou. O rascunho continua preservado; entre novamente antes de publicar.";
		case "profile_unresolved":
			return "A publicação não aconteceu: sua conta ainda não está vinculada a um perfil autorizado. O rascunho continua preservado.";
		case "forbidden":
			return "A publicação não aconteceu: sua conta não possui permissão para esta edição. O rascunho continua preservado.";
		case "conflict":
			return "A publicação não aconteceu porque o Mundo publicado mudou desde o início desta edição. Seu rascunho foi preservado para reconciliação.";
		case "lease_lost":
			return "A publicação não aconteceu porque a sessão exclusiva expirou. Seu rascunho foi preservado; reabra a condução para recuperá-lo.";
		case "invalid_payload":
			return "A publicação não aconteceu porque existe um campo inválido no rascunho. Nada foi publicado e o rascunho continua preservado.";
		case "duplicate":
			return "A publicação não aconteceu porque ainda existe um nome, slug ou ligação incompatível/duplicada. Nada foi publicado e o rascunho continua preservado.";
		case "review_required":
			return "A publicação não aconteceu: há conteúdo marcado para campanha/web sem a revisão ou fonte canônica exigida. O rascunho continua preservado.";
		case "media_pending":
			return "A publicação não aconteceu porque uma imagem ainda não pôde ser verificada. O rascunho e a sessão foram preservados; tente novamente depois da verificação.";
		case "dependency_unavailable":
			return "A publicação não pôde ser confirmada por uma falha de servidor ou rede. Nada foi publicado; o rascunho preservado não será descartado.";
		default:
			return "A publicação não pôde ser confirmada. Nada foi publicado e o rascunho continua preservado.";
	}
}

export function worldDraftSaveFailureMessage(reason: string): string {
	switch (reason) {
		case "lease_lost":
			return "A sessão exclusiva expirou. O último rascunho confirmado continua preservado; reabra a condução antes de continuar.";
		case "conflict":
			return "O Mundo publicado mudou e este rascunho ficou desatualizado. Ele continua preservado e precisa ser reconciliado antes de publicar.";
		case "forbidden":
			return "Não foi possível salvar o rascunho porque sua permissão mudou. Mantenha esta aba aberta até recuperar a sessão.";
		case "invalid_payload":
			return "O rascunho contém um campo inválido e não pôde ser salvo. Corrija a alteração antes de sair desta página.";
		case "duplicate":
			return "O rascunho contém um conflito de nome, slug ou ligação e ainda não pôde ser salvo. Corrija-o antes de sair desta página.";
		default:
			return "Não foi possível confirmar o salvamento do rascunho. Mantenha esta aba aberta e tente novamente antes de sair.";
	}
}

/** Backward-compatible generic mapping for callers that do not know the phase yet. */
export function worldEditFailureMessage(reason: string): string {
	return worldPublishFailureMessage(reason);
}

export function worldLayoutPositionsEqual(
	left: Readonly<Record<string, Readonly<{ x: number; y: number }>>>,
	right: Readonly<Record<string, Readonly<{ x: number; y: number }>>>,
): boolean {
	const leftIds = Object.keys(left).sort();
	const rightIds = Object.keys(right).sort();
	if (leftIds.length !== rightIds.length) return false;
	return leftIds.every((id, index) => {
		if (id !== rightIds[index]) return false;
		return left[id]?.x === right[id]?.x && left[id]?.y === right[id]?.y;
	});
}
