import { canManageCampaignRegistry } from "@/features/campaigns/policy";
import { toolNavigationItemsForCampaign } from "@/components/public-navigation-model";
import { EDIT_CAPABILITIES, type EditAccessContext } from "./access/policy";
import { authorizeCampaignCapability } from "./access/policy";

const PRIORITY = [
 EDIT_CAPABILITIES.transcriptRead, EDIT_CAPABILITIES.localProcess,
 EDIT_CAPABILITIES.worldLayoutEdit, EDIT_CAPABILITIES.reviewRead,
 EDIT_CAPABILITIES.permissionsManage,
] as const;

export function firstAuthorizedEditDestination(
 context: EditAccessContext, campaignSlug: string, now = new Date(),
): string | null {
 if (canManageCampaignRegistry(context, now)) return "/edit/campanhas";
 const tools = toolNavigationItemsForCampaign(campaignSlug, PRIORITY);
 for (const capability of PRIORITY) {
  if (!authorizeCampaignCapability(context, capability, campaignSlug, now).ok) continue;
  const tool = tools.find((item) => item.capability === capability && item.icon !== "transcripts");
  if (tool) return tool.href;
 }
 return null;
}
