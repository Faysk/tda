import { notFound } from "next/navigation";
import CampaignToolPage from "@/app/transcricoes/page";
export { metadata } from "@/app/transcricoes/page";
export const dynamic = "force-dynamic";

export default async function ScopedCampaignTool({ params, searchParams }: {
 params: Promise<{ campaignSlug: string }>;
 searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
 const [{ campaignSlug }, query] = await Promise.all([params, searchParams]);
 if (!/^[A-Za-z0-9_-]{1,128}$/u.test(campaignSlug)) notFound();
 if (query.campanha !== undefined && query.campanha !== campaignSlug) notFound();
 return CampaignToolPage({ searchParams: Promise.resolve({ ...query, campanha: campaignSlug }) });
}
