import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import ProcessingPage from "../../processamento/page";
import { processingCampaignHref } from "@/features/edit/processing/campaign-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Processamento",
	description: "Fila e conexão com o serviço local de processamento.",
};

type Props = {
	params: Promise<{ campaignSlug: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SAFE_CAMPAIGN_SLUG = /^[A-Za-z0-9_-]{1,128}$/u;

function first(value: string | string[] | undefined): string | null {
	return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export default async function CampaignProcessingPage({
	params,
	searchParams,
}: Props) {
	const [{ campaignSlug }, query] = await Promise.all([params, searchParams]);
	if (!SAFE_CAMPAIGN_SLUG.test(campaignSlug)) notFound();

	const requested = first(query.campanha);
	if (requested && requested !== campaignSlug) {
		if (!SAFE_CAMPAIGN_SLUG.test(requested)) notFound();
		redirect(processingCampaignHref(requested));
	}

	return ProcessingPage({
		campaignPath: campaignSlug,
		searchParams: Promise.resolve({
			...query,
			campanha: campaignSlug,
		}),
	});
}
