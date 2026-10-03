import { notFound } from "next/navigation";
import { StaleActionRecoveryFixture } from "@/features/edit/stale-action-recovery-fixture";

export const dynamic = "force-dynamic";

export default function StaleActionRecoveryE2EPage() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	return <StaleActionRecoveryFixture />;
}
