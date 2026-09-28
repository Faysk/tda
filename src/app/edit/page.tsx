import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAccess } from "@/features/auth/server";
import { resolveEditEntrypoint } from "@/features/auth/edit-entrypoint";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";

export const metadata: Metadata = {
	title: "Edit",
	description: "Entrypoint de compatibilidade para as ferramentas do TDA.",
};

export default async function EditPage() {
	const access = await currentAccess();

	if (access.state === "anonymous") redirect("/entrar?next=%2Fedit");
	if (access.state === "unavailable") redirect("/conta?acesso=indisponivel");
	if (access.state !== "authenticated_linked" || !access.context)
		redirect("/conta?acesso=negado");

	const target = resolveEditEntrypoint(access.context, CAMPAIGN_SLUG);
	if (!target) redirect("/conta?acesso=negado");

	redirect(target);
}
