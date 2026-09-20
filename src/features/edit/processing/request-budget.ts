import type { CraigTranscriptionInput } from "./protocol";

export const LOCAL_JSON_BODY_MAX_BYTES = 4096;
export const TRANSCRIPTION_TEXT_MAX_CHARS = 1200;

export type CraigTranscriptionRequest = Readonly<{
	kind: "transcription.craig";
	campaign_id: string;
	session_id: string;
	source_id: string;
	profile_id: CraigTranscriptionInput["profileId"];
	glossary: string;
	context: string;
	cpu: false;
}>;

export function truncateUnicodeScalars(value: string, max: number): string {
	return Array.from(value).slice(0, max).join("");
}

export function buildCraigTranscriptionRequest(
	input: CraigTranscriptionInput,
): CraigTranscriptionRequest {
	return {
		kind: "transcription.craig",
		campaign_id: input.campaignId,
		session_id: input.sessionId,
		source_id: input.sourceId,
		profile_id: input.profileId,
		glossary: truncateUnicodeScalars(input.glossary, TRANSCRIPTION_TEXT_MAX_CHARS),
		context: truncateUnicodeScalars(input.context, TRANSCRIPTION_TEXT_MAX_CHARS),
		cpu: false,
	};
}

export function serializedJsonBody(value: unknown): {
	body: string;
	byteLength: number;
} {
	const body = JSON.stringify(value);
	if (body === undefined) throw new TypeError("JSON_BODY_UNSERIALIZABLE");
	return {
		body,
		byteLength: new TextEncoder().encode(body).byteLength,
	};
}

export function craigTranscriptionRequestByteLength(
	input: CraigTranscriptionInput,
): number {
	return serializedJsonBody(buildCraigTranscriptionRequest(input)).byteLength;
}
