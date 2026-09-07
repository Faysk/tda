export type PermissionOrigin = Readonly<{
	assignmentId: string;
	roleSlug: string;
	roleName: string;
	scopeType: "campaign" | "project";
	scopeId: string;
}>;

export type PermissionPerson = Readonly<{
	id: string;
	displayName: string;
	authLinked: boolean;
	discordLinked: boolean;
	roles: readonly Readonly<{
		id: string;
		name: string;
		slug: string;
		actions: readonly string[];
		scopeType: "campaign" | "project";
		scopeId: string;
		status: string;
		startsAt: string;
		endsAt: string | null;
		active: boolean;
	}>[];
	verifiedEditAccess: readonly Readonly<{
		action: string;
		origins: readonly PermissionOrigin[];
	}>[];
}>;

export type PermissionsDirectory = Readonly<{
	campaign: Readonly<{ slug: string; name: string }>;
	people: readonly PermissionPerson[];
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
		title: "Entre para consultar permissões",
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
			"Sua conta não tem autorização para consultar as permissões desta campanha. Fale com a pessoa responsável pela campanha.",
	},
	validation: {
		title: "Consulta inválida",
		description:
			"Confira o endereço da campanha e abra novamente a consulta de permissões.",
	},
	dependency_unavailable: {
		title: "Consulta indisponível",
		description:
			"Não foi possível verificar o acesso ou carregar as permissões. Nenhum dado será mostrado até a verificação funcionar. Tente novamente em instantes.",
	},
	not_found: {
		title: "Campanha não encontrada",
		description:
			"Não foi possível abrir esta campanha. Confira o endereço da consulta.",
	},
};
