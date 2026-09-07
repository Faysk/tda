import type { BridgeErrorCode, JobStatus } from "./protocol";

export const connectionHelp: Record<BridgeErrorCode, string> = {
	unreachable:
		"Não foi possível alcançar o serviço. Confira se ele está aberto neste computador e se este site tem permissão de acesso à rede local. O navegador não informa se a causa é conexão, origem ou permissão.",
	timeout:
		"O serviço não respondeu a tempo. Confira o aplicativo local e conecte novamente. Uma ação enviada pode ter sido recebida; verifique a fila antes de repetir.",
	unauthorized:
		"Pareamento recusado ou revogado. Copie um token válido do aplicativo local e conecte novamente.",
	forbidden:
		"O serviço recusou este acesso. Confira no aplicativo local se a origem exata deste site está autorizada.",
	incompatible:
		"Versão incompatível. Esta tela requer a API v1. Use uma versão compatível do serviço local.",
	invalid_response:
		"O serviço retornou dados inválidos para este contrato. Confira sua versão e consulte o suporte com o código invalid_response.",
	conflict:
		"O estado do trabalho mudou. Conecte novamente para consultar a fila antes de tentar outra ação.",
	service_error:
		"O serviço não concluiu a solicitação. Confira o diagnóstico no aplicativo local e conecte novamente.",
};
export const jobLabels: Record<JobStatus, string> = {
	queued: "Na fila",
	running: "Em execução",
	succeeded: "Concluído localmente",
	failed: "Falhou",
	cancelled: "Cancelado",
	interrupted: "Interrompido",
};
export const stageLabels: Record<string, string> = {
	queued: "Aguardando execução",
	fixture: "Ensaio sintético",
	complete: "Resultado preparado",
	cancelled: "Cancelado",
	interrupted: "Execução interrompida",
};
