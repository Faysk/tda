export const PERMISSION_LABELS: Readonly<Record<string, string>> = {
	"campaign.permissions.manage": "Gerenciar permissões",
	"campaign.access.manage": "Gerenciar vínculos e participação",
	"campaign.edit.access": "Abrir o Edit",
	"campaign.transcript.read": "Ler transcrições completas",
	"campaign.transcript.import": "Importar transcrições",
	"campaign.transcript.publish": "Publicar transcrições",
	"campaign.content.edit": "Editar conteúdo",
	"campaign.sessions.publish": "Publicar sessões",
	"campaign.local.process": "Usar processamento local",
	"campaign.processing.barks.manage": "Gerenciar barks do processamento",
	"campaign.upload.manage": "Gerenciar importações",
	"campaign.companion.download": "Baixar o Companion",
	"campaign.audio.read": "Ouvir áudio local",
	"campaign.read": "Ler material autorizado da campanha",
	"campaign.world.layout.edit": "Editar composição do Mundo",
	"narrative.review.read": "Ler fila de revisão narrativa",
	"narrative.review.manage": "Classificar candidatos narrativos",
	"narrative.canon.approve": "Aprovar cânone",
	"narrative.dm_notes.read": "Ler notas privadas do mestre",
	"narrative.notes.review": "Revisar notas narrativas",
	"narrative.roll20.ingest": "Importar material do Roll20",
	"project.costs.read": "Consultar custos do projeto",
	"project.deployments.read": "Consultar deployments",
	"project.jobs.read": "Consultar jobs técnicos",
	"project.jobs.run": "Executar jobs técnicos",
	"project.logs.read_redacted": "Consultar logs sanitizados",
	"project.monitor.read": "Consultar monitoramento",
	"project.rbac.manage": "Administrar RBAC do projeto",
	"project.tokens.status.read": "Consultar estado de tokens",
};

export const SENSITIVE_PERMISSION_ACTIONS = [
	"campaign.permissions.manage",
	"campaign.sessions.publish",
	"campaign.transcript.publish",
	"narrative.canon.approve",
] as const;

export type PermissionOrigin = Readonly<{
	assignmentId: string;
	roleSlug: string;
	roleName: string;
	scopeType: "campaign" | "project";
	scopeId: string;
}>;

export type PermissionAssignment = Readonly<{
	id: string;
	roleId: string;
	name: string;
	slug: string;
	actions: readonly string[];
	scopeType: "campaign" | "project";
	scopeId: string;
	status: string;
	startsAt: string;
	endsAt: string | null;
	updatedAt: string;
	active: boolean;
}>;

export type PermissionPerson = Readonly<{
	id: string;
	displayName: string;
	authLinked: boolean;
	discordLinked: boolean;
	campaignMember: boolean;
	isCurrentActor: boolean;
	revision: number;
	roles: readonly PermissionAssignment[];
	verifiedEditAccess: readonly Readonly<{
		action: string;
		origins: readonly PermissionOrigin[];
	}>[];
}>;

export type PermissionRoleDefinition = Readonly<{
	id: string;
	name: string;
	slug: string;
	description: string;
	plane: string;
	isSystem: boolean;
	actions: readonly string[];
	peopleCount: number;
	delegable: boolean;
	delegationReason: string | null;
	sensitive: boolean;
}>;

export type PermissionAuditEvent = Readonly<{
	id: string;
	operationId: string | null;
	operation: "grant" | "revoke";
	actorProfileId: string | null;
	actorDisplayName: string;
	targetProfileId: string | null;
	targetDisplayName: string;
	roleId: string | null;
	roleName: string;
	reason: string | null;
	createdAt: string;
}>;

export type PermissionsDirectory = Readonly<{
	campaign: Readonly<{ slug: string; name: string }>;
	actorProfileId: string;
	people: readonly PermissionPerson[];
	roles: readonly PermissionRoleDefinition[];
	history: readonly PermissionAuditEvent[];
	checkedAt: string;
}>;

export type PermissionsFailure =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "validation"
	| "dependency_unavailable"
	| "not_found";

export type PermissionsResult =
	| Readonly<{ ok: true; value: PermissionsDirectory }>
	| Readonly<{ ok: false; reason: PermissionsFailure }>;

export const PERMISSIONS_MESSAGES: Record<
	PermissionsFailure,
	Readonly<{ title: string; description: string }>
> = {
	unauthenticated: {
		title: "Entre para administrar permissões",
		description:
			"Use sua conta do Discord. Entrar não concede acesso à administração.",
	},
	profile_unresolved: {
		title: "Conta sem perfil vinculado",
		description:
			"Sua conta ainda precisa ser associada a um perfil. Fale com a pessoa responsável pela campanha.",
	},
	forbidden: {
		title: "Sem acesso às permissões",
		description:
			"Sua conta não tem autorização para administrar as permissões desta campanha.",
	},
	validation: {
		title: "Consulta inválida",
		description:
			"Confira o endereço da campanha e abra novamente a administração de permissões.",
	},
	dependency_unavailable: {
		title: "Administração indisponível",
		description:
			"Não foi possível verificar o acesso ou carregar as permissões. Nenhum dado será mostrado até a verificação funcionar. Tente novamente em instantes.",
	},
	not_found: {
		title: "Campanha não encontrada",
		description:
			"Não foi possível abrir esta campanha. Confira o endereço da administração.",
	},
};
