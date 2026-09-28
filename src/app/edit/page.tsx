import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAccess } from "@/features/auth/server";
import { firstAuthorizedEditDestination } from "@/features/edit/navigation-entry";

export const metadata: Metadata = {
	title: "Edit",
	description: "Entrypoint de compatibilidade para as ferramentas administrativas do TDA.",
};

export default async function EditPage() {
	const access = await currentAccess();

	if (access.state === "anonymous") redirect("/entrar?next=%2Fedit");
	if (access.state === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (access.state !== "authenticated_linked" || !access.context)
		redirect("/conta?acesso=negado");

	const destination = firstAuthorizedEditDestination(access.context);
	redirect(destination ?? "/conta?acesso=negado");
}
