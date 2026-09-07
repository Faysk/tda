import "server-only";
import { authConfig } from "@/features/auth/config";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import { deniedImportDependencies } from "./consumer";
import { createImportHandler } from "./http";

const dependencies = {
	origin: () => authConfig()?.origin ?? null,
	identity: getVerifiedServerIdentity,
	consumer: deniedImportDependencies,
};
export const importPost = createImportHandler(dependencies);
export const receiptPost = createImportHandler(dependencies, true);
