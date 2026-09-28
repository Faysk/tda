import "server-only";
import { authConfig } from "@/features/auth/config";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import { deniedPublicationDependencies } from "./consumer";
import { createCurrentPublicationHandler } from "./current";
import { createCurrentPublicationMutationHandler } from "./current-mutation";
import { createPublicationHandler } from "./http";
import {
	databasePublicationDependencies,
	readCurrentPublication,
	setCurrentPublication,
} from "./repository";

const publication =
	process.env.TDA_TRANSCRIPT_PUBLICATION_ENABLED === "true"
		? databasePublicationDependencies
		: deniedPublicationDependencies;

const dependencies = {
	origin: () => authConfig()?.origin ?? null,
	identity: getVerifiedServerIdentity,
	publication,
};

export const publicationPost = createPublicationHandler(dependencies);
export const publicationReceiptPost = createPublicationHandler(
	dependencies,
	true,
);
export const publicationCurrentPost = createCurrentPublicationHandler({
	...dependencies,
	read: readCurrentPublication,
});
export const publicationCurrentMutationPost =
	createCurrentPublicationMutationHandler({
		...dependencies,
		mutate: setCurrentPublication,
	});
