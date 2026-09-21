import "server-only";

import { serverAuthClient } from "@/features/auth/server";

export type LembraIdentity = Readonly<{
	authUserId: string;
	displayName: string;
}>;

export type LembraAccess =
	| Readonly<{ ok: true; identity: LembraIdentity }>
	| Readonly<{
			ok: false;
			reason: "unauthenticated" | "dependency_unavailable";
	  }>;

function cleanName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 120) return null;
	return trimmed;
}

function identityDisplayName(user: {
	email?: string | null;
	user_metadata?: Record<string, unknown> | null;
	identities?: Array<{ identity_data?: Record<string, unknown> | null }>;
}) {
	const metadata = user.user_metadata ?? {};
	const identityData =
		user.identities?.find((identity) => identity.identity_data)?.identity_data ?? {};

	for (const value of [
		metadata.display_name,
		metadata.full_name,
		metadata.name,
		metadata.preferred_username,
		metadata.user_name,
		metadata.username,
		identityData.display_name,
		identityData.full_name,
		identityData.name,
		identityData.preferred_username,
		identityData.user_name,
		identityData.username,
	]) {
		const name = cleanName(value);
		if (name) return name;
	}

	const email = cleanName(user.email);
	if (email) return email.split("@", 1)[0] || "Usuário TDA";
	return "Usuário TDA";
}

export async function getLembraIdentity(): Promise<LembraAccess> {
	try {
		const client = await serverAuthClient();
		if (!client) return { ok: false, reason: "dependency_unavailable" };

		const { data, error } = await client.auth.getUser();
		if (error || !data.user) {
			return {
				ok: false,
				reason:
					error && (!error.status || error.status >= 500)
						? "dependency_unavailable"
						: "unauthenticated",
			};
		}

		return {
			ok: true,
			identity: {
				authUserId: data.user.id,
				displayName: identityDisplayName(data.user),
			},
		};
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}
