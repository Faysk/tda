import { notFound } from "next/navigation";
import LoadingPermissions from "@/app/edit/[campaignSlug]/permissions/loading";
import LembraLoading from "@/app/lembra/loading";
import {
	GlobalErrorFixture,
	LembraErrorFixture,
} from "../system-state-fixtures";

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
	if (state === "error") return <GlobalErrorFixture />;
	if (state === "lembra-error") return <LembraErrorFixture />;

	notFound();
}
