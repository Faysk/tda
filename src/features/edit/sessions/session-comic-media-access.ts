import "server-only";

// HQ pages use the same session-level content-edit permission as cover images.
// The asset role/key checks remain independent in the comic media actions.
export {
	authorizeSessionCoverTarget as authorizeSessionComicTarget,
} from "./session-cover-media-access";
