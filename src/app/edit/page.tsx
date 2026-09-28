import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAccess } from "@/features/auth/server";
import { resolveEditCompatibilityTarget } from "@/features/edit/navigation";

export const metadata: Metadata = {
	title: "Edit",
	description: "Entrada de compatibilidade para as ferramentas administrativas do TDA.",
};

export default async function EditPage() {
	const access = await currentAccess();
	redirect(resolveEditCompatibilityTarget(access));
}
