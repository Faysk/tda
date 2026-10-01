import "@xyflow/react/dist/style.css";
import { WorldWorkspaceShell } from "@/features/world-shell/world-workspace-shell";

export default function CampaignWorldLayout({ children }: { children: React.ReactNode }) {
	return <WorldWorkspaceShell>{children}</WorldWorkspaceShell>;
}
