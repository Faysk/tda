import { notFound } from "next/navigation";
import LoadingPermissions from "@/app/edit/[campaignSlug]/permissions/loading";
import LembraLoading from "@/app/lembra/loading";

export const dynamic = "force-dynamic";

export default async function SystemStatesE2EFixture({
	params,
}: {
	params: Promise<{ state: string }>;
}) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();

	const { state } = await params;

	if (state === "lembra-loading") return <LembraLoading />;
	if (state === "permissions-loading") return <LoadingPermissions />;
	if (state === "error") {
		throw new Error("Synthetic system-state fixture error");
	}

	notFound();
}
