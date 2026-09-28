import { notFound } from "next/navigation";
import { SessionEditorialE2EFixture } from "@/features/edit/sessions/session-editorial-e2e-fixture";

export const dynamic = "force-dynamic";

export default function SessionEditorialE2EPage() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	return <SessionEditorialE2EFixture />;
}
