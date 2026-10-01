import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import NarrativeReviewPage from "../../revisao/page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Revisão narrativa · Edit",
	description: "Fila humana de revisão antes da entrada no cânone da campanha.",
	robots: { index: false, follow: false },
};

type Props = {
	params: Promise<{ campaignSlug: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SAFE_CAMPAIGN_SLUG = /^[A-Za-z0-9_-]{1,128}$/u;

function first(value: string | string[] | undefined): string | null {
	return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function campaignHref(campaignSlug: string): string {
	if (!SAFE_CAMPAIGN_SLUG.test(campaignSlug)) throw new Error("invalid campaign slug");
	return `/edit/${encodeURIComponent(campaignSlug)}/revisao`;
}

export default async function CampaignReviewPage({
	params,
	searchParams,
}: Props) {
	const [{ campaignSlug }, query] = await Promise.all([params, searchParams]);
	if (!SAFE_CAMPAIGN_SLUG.test(campaignSlug)) notFound();

	const requested = first(query.campanha);
	if (requested && requested !== campaignSlug) {
		if (!SAFE_CAMPAIGN_SLUG.test(requested)) notFound();
		redirect(campaignHref(requested));
	}

	return NarrativeReviewPage({
		searchParams: Promise.resolve({
			...query,
			campanha: campaignSlug,
		}),
	});
}
