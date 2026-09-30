import { NextResponse } from "next/server";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { editDataClient } from "@/integrations/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_CAMPAIGN_SLUG = /^[A-Za-z0-9_-]{1,128}$/u;

function json(
	body: Readonly<Record<string, unknown>>,
	status: number,
): NextResponse {
	const response = NextResponse.json(body, { status });
	response.headers.set("Cache-Control", "private, no-store");
	return response;
}

export async function POST(request: Request) {
	let raw: unknown;
	try {
		const text = await request.text();
		if (!text || Buffer.byteLength(text, "utf8") > 512)
			return json({ ok: false, reason: "invalid_request" }, 400);
		raw = JSON.parse(text);
	} catch {
		return json({ ok: false, reason: "invalid_request" }, 400);
	}

	const campaignSlug =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? (raw as { campaignSlug?: unknown }).campaignSlug
			: null;
	if (typeof campaignSlug !== "string" || !SAFE_CAMPAIGN_SLUG.test(campaignSlug))
		return json({ ok: false, reason: "invalid_request" }, 400);

	const authorization = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.localProcess,
		campaignSlug,
	});
	if (!authorization.ok) {
		if (authorization.reason === "dependency_unavailable")
			return json({ ok: false, reason: "dependency_unavailable" }, 503);
		return json({ ok: false, reason: "campaign_unavailable" }, 403);
	}

	const client = editDataClient();
	if (!client)
		return json({ ok: false, reason: "dependency_unavailable" }, 503);
	const { data, error } = await client
		.from("campaigns")
		.select("slug")
		.eq("slug", campaignSlug)
		.eq("lifecycle", "active")
		.maybeSingle();
	if (error)
		return json({ ok: false, reason: "dependency_unavailable" }, 503);
	if (!data)
		return json({ ok: false, reason: "campaign_unavailable" }, 409);

	return json({ ok: true, campaignSlug }, 200);
}
