import "server-only";
import { authConfig } from "@/features/auth/config";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import { deniedPublicationDependencies } from "./consumer";
import { createPublicationHandler } from "./http";

const dependencies = {
	origin: () => authConfig()?.origin ?? null,
	identity: getVerifiedServerIdentity,
	publication: deniedPublicationDependencies,
};

export const publicationPost = createPublicationHandler(dependencies);
export const publicationReceiptPost = createPublicationHandler(
	dependencies,
	true,
);
