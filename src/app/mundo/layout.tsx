import { WorldWorkspaceShell } from "@/features/world-shell/world-workspace-shell";

export default function MundoLayout({ children }: { children: React.ReactNode }) {
	return <WorldWorkspaceShell>{children}</WorldWorkspaceShell>;
}
