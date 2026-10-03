import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditCapability,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { authClient } from "./client";
import { safeReturnPath } from "./config";
import { navigationIdentityFromMetadata } from "./presentation";

export async function serverAuthClient() {
	const jar = await cookies();
	return authClient({
		getAll: () => jar.getAll(),
		setAll: (values) => {
			try {
				for (const { name, value, options } of values)
					jar.set(name, value, options);
			} catch {
				/* Server Components are read-only; proxy propagates refresh cookies. */
			}
		},
	});
}

export async function getVerifiedServerIdentity() {
	try {
		const client = await serverAuthClient();
		if (!client)
			return { ok: false, reason: "dependency_unavailable" } as const;
		const { data, error } = await client.auth.getUser();
		if (error || !data.user)
			return {
				ok: false,
				reason:
					error && (!error.status || error.status >= 500)
						? "dependency_unavailable"
						: "unauthenticated",
			} as const;
		return {
			ok: true,
			authUserId: data.user.id,
			navigationIdentity: navigationIdentityFromMetadata(
				data.user.user_metadata,
			),
		} as const;
	} catch {
		return { ok: false, reason: "dependency_unavailable" } as const;
	}
}

export async function authorizeCampaignCapabilityServer(input: {
	action: EditCapability;
	campaignSlug: string;
}) {
	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) return identity;
	try {
		const context = await loadEditAccessContext(identity.authUserId);
		if (!context)
			return { ok: false, reason: "dependency_unavailable" } as const;
		const decision = authorizeCampaignCapability(
			context,
			input.action,
			input.campaignSlug,
		);
		return decision.ok
			? { ...decision, authUserId: identity.authUserId }
			: decision;
	} catch {
		return { ok: false, reason: "dependency_unavailable" } as const;
	}
}

export const currentAccess = cache(async () => {
	try {
		const identity = await getVerifiedServerIdentity();
		if (!identity.ok)
			return {
				state:
					identity.reason === "unauthenticated" ? "anonymous" : "unavailable",
				context: null,
				identity: null,
			} as const;
		const context = await loadEditAccessContext(identity.authUserId);
		if (!context)
			return {
				state: "unavailable",
				context: null,
				identity: identity.navigationIdentity,
			} as const;
		if (!context.profileId)
			return {
				state: "authenticated_unlinked",
				context,
				identity: identity.navigationIdentity,
			} as const;
		const editActions = new Set<string>(Object.values(EDIT_CAPABILITIES));
		const effective = context.grants.some((grant) => {
			if (!editActions.has(grant.action)) return false;
			const campaignSlug =
				grant.scopeType === "campaign" ? grant.scopeId : CAMPAIGN_SLUG;
			return authorizeCampaignCapability(
				context,
				grant.action as EditCapability,
				campaignSlug,
			).ok;
		});
		return {
			state: effective
				? "authenticated_linked"
				: "authenticated_linked_no_grants",
			context,
			identity: identity.navigationIdentity,
		} as const;
	} catch {
		return { state: "unavailable", context: null, identity: null } as const;
	}
});

export async function requireCampaignCapability(
	capability: EditCapability,
	campaignSlug: string,
	returnTo = "/edit",
) {
	const access = await currentAccess();
	if (access.state === "anonymous")
		redirect(`/entrar?next=${encodeURIComponent(safeReturnPath(returnTo))}`);
	if (access.state === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (
		!access.context ||
		!authorizeCampaignCapability(access.context, capability, campaignSlug).ok
	)
		redirect("/conta?acesso=negado");
	return access.context;
}

export async function requireCapability(
	capability: EditCapability,
	returnTo = "/edit",
) {
	const access = await currentAccess();
	if (access.state === "anonymous")
		redirect(`/entrar?next=${encodeURIComponent(safeReturnPath(returnTo))}`);
	if (access.state === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (
		!access.context ||
		!authorizeCampaignCapability(access.context, capability, CAMPAIGN_SLUG).ok
	)
		redirect("/conta?acesso=negado");
	return access.context;
}
