import { canManageCampaignRegistry } from "@/features/campaigns/policy";
import { authorizeCampaignCapability, EDIT_CAPABILITIES, type EditAccessContext, type EditCapability } from "@/features/edit/access/policy";
import { LEGACY_CAMPAIGN_TECHNICAL_SLUG } from "@/features/sessions/model";

export type EditEntryDestination = Readonly<{ href: string; capability: EditCapability }>;
const campaignQuery=(href:string,slug:string)=>`${href}?campanha=${encodeURIComponent(slug)}`;
const campaignEditHref=(slug:string,tool:"sessoes"|"mundo"|"permissions")=>`/edit/${encodeURIComponent(slug)}/${tool}`;
const destinationsForCampaign=(slug:string):readonly EditEntryDestination[]=>[
	{href:campaignEditHref(slug,"sessoes"),capability:EDIT_CAPABILITIES.transcriptRead},
	{href:campaignQuery("/edit/processamento",slug),capability:EDIT_CAPABILITIES.localProcess},
	{href:campaignEditHref(slug,"mundo"),capability:EDIT_CAPABILITIES.worldLayoutEdit},
	{href:campaignQuery("/edit/revisao",slug),capability:EDIT_CAPABILITIES.reviewRead},
	{href:campaignEditHref(slug,"permissions"),capability:EDIT_CAPABILITIES.permissionsManage},
];
export const EDIT_ENTRY_PRIORITY=destinationsForCampaign(LEGACY_CAMPAIGN_TECHNICAL_SLUG);
export function firstAuthorizedEditDestination(context:EditAccessContext,campaignSlug=LEGACY_CAMPAIGN_TECHNICAL_SLUG,now=new Date()):string|null{
	if(canManageCampaignRegistry(context,now))return "/edit/campanhas";
	for(const destination of destinationsForCampaign(campaignSlug)){
		if(authorizeCampaignCapability(context,destination.capability,campaignSlug,now).ok)return destination.href;
	}
	return null;
}
