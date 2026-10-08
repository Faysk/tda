import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import type {
	EditAccessContext,
	EditCapability,
} from "@/features/edit/access/policy";
import { readAuthorizedCampaigns, type AuthorizedCampaign } from "./authorized";

export type AuthorizedCampaignRoute = AuthorizedCampaign &
	Readonly<{ routeKey: string }>;

export function resolveAuthorizedCampaignReference(
	campaigns: readonly AuthorizedCampaignRoute[],
	reference: string,
): AuthorizedCampaignRoute | null {
	return (
		campaigns.find((campaign) => campaign.routeKey === reference) ??
		campaigns.find((campaign) => campaign.technicalSlug === reference) ??
		null
	);
}

/** Resolve presentation addresses only inside the server-authorized campaign set. */
export async function readAuthorizedCampaignRoutes(
	context: EditAccessContext,
	capability: EditCapability,
	options: Readonly<{ includeArchived?: boolean }> = {},
): Promise<
	| Readonly<{ ok: true; campaigns: readonly AuthorizedCampaignRoute[] }>
	| Readonly<{
			ok: false;
			reason: "profile_unresolved" | "dependency_unavailable";
	  }>
> {
	try {
		const eligible = await readAuthorizedCampaigns(
			context,
			capability,
			options,
		);
		if (!eligible.ok) return eligible;
		if (!eligible.campaigns.length) return { ok: true, campaigns: [] };
		const client = editDataClient();
		if (!client)
			return { ok: false as const, reason: "dependency_unavailable" as const };
		const { data, error } = await client
			.from("campaigns")
			.select("slug,public_slug")
			.in(
				"slug",
				eligible.campaigns.map((campaign) => campaign.technicalSlug),
			);
		if (error || !Array.isArray(data))
			return { ok: false as const, reason: "dependency_unavailable" as const };
		const routes = new Map<string, string>();
		const authorizedSlugs = new Set(
			eligible.campaigns.map((campaign) => campaign.technicalSlug),
		);
		for (const row of data) {
			if (
				!row ||
				typeof row.slug !== "string" ||
				typeof row.public_slug !== "string" ||
				!authorizedSlugs.has(row.slug) ||
				!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(row.public_slug) ||
				routes.has(row.slug)
			)
				return {
					ok: false as const,
					reason: "dependency_unavailable" as const,
				};
			routes.set(row.slug, row.public_slug);
		}
		const campaigns: AuthorizedCampaignRoute[] = [];
		for (const campaign of eligible.campaigns) {
			const routeKey = routes.get(campaign.technicalSlug);
			if (!routeKey)
				return {
					ok: false as const,
					reason: "dependency_unavailable" as const,
				};
			campaigns.push({ ...campaign, routeKey });
		}
		if (
			new Set(campaigns.map((campaign) => campaign.routeKey)).size !==
			campaigns.length
		)
			return { ok: false as const, reason: "dependency_unavailable" as const };
		return { ok: true as const, campaigns };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}
