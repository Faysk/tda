import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCapability } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";

export const metadata: Metadata = {
	title: "Mundo · Edit",
	description: "Entrypoint de compatibilidade para o authoring do World Explorer.",
};

export default async function EditWorldCompatibilityPage() {
	await requireCapability(EDIT_CAPABILITIES.worldLayoutEdit, "/edit/mundo");
	redirect("/mundo");
}
