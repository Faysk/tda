import { describe, expect, it } from "vitest";
import {
	EMPTY_SESSION_CAMPAIGN_MOVE_DECISIONS,
	requiredSessionCampaignMoveDecisions,
	sessionCampaignMovePlanHeading,
	validSessionCampaignMoveRecoveryIntent,
	type SessionCampaignMovePreview,
} from "./session-campaign-move-model";

const preview: SessionCampaignMovePreview = {
	status: "ready",
	contractVersion: 2,
	sessionId: "41000000-0000-4000-8000-000000000001",
	sourceSessionId: "session-1",
	sourceCampaignSlug: "campaign-a",
	destinationCampaignSlug: "campaign-b",
	blockers: [],
	plan: [
		{
			family: "transcript_revisions",
			classification: "auto",
			count: 2,
			message: "Transcrições acompanham a sessão.",
			action: null,
		},
		{
			family: "participant_entity_links",
			classification: "decision",
			count: 1,
			message: "Desvincular entity.",
			action: "unlink_participant_entities",
		},
		{
			family: "session_scoped_grants",
			classification: "decision",
			count: 1,
			message: "Revogar grants.",
			action: "revoke_session_grants",
		},
		{
			family: "historical_publication_retention",
			classification: "decision",
			count: 1,
			message: "Reconhecer retenção histórica.",
			action: "acknowledge_historical_publication",
		},
	],
	consequences: [],
};

describe("session campaign move model", () => {
	it("derives only the explicit decisions required by the preflight", () => {
		expect(requiredSessionCampaignMoveDecisions(preview)).toEqual({
			unlinkParticipantEntities: true,
			revokeSessionGrants: true,
			acknowledgeHistoricalPublication: true,
		});
		expect(requiredSessionCampaignMoveDecisions(null)).toEqual(
			EMPTY_SESSION_CAMPAIGN_MOVE_DECISIONS,
		);
	});

	it("uses human headings for plan classifications", () => {
		expect(sessionCampaignMovePlanHeading("auto")).toBe("Acompanha automaticamente");
		expect(sessionCampaignMovePlanHeading("external_prepare")).toBe(
			"Preparação antes do commit",
		);
		expect(sessionCampaignMovePlanHeading("decision")).toBe(
			"Precisa da sua confirmação",
		);
		expect(sessionCampaignMovePlanHeading("historical")).toBe(
			"Permanece como histórico",
		);
	});

	it("accepts only scoped, typed recovery intents", () => {
		const intent = {
			version: 1,
			sessionId: preview.sessionId,
			sourceSessionId: preview.sourceSessionId,
			sourceCampaignSlug: preview.sourceCampaignSlug,
			destinationCampaignSlug: preview.destinationCampaignSlug,
			operationId: "61000000-0000-4000-8000-000000000001",
		};
		expect(validSessionCampaignMoveRecoveryIntent(intent)).toBe(true);
		expect(
			validSessionCampaignMoveRecoveryIntent({
				...intent,
				operationId: 123,
			}),
		).toBe(false);
	});
});
