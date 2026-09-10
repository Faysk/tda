import type { Metadata } from "next";
import { EditShell } from "@/features/edit/shell/edit-shell";
import "./edit-shell-global.css";

export const metadata: Metadata = {
	robots: {
		index: false,
		follow: false,
	},
};

export default function EditLayout({ children }: { children: React.ReactNode }) {
	return <EditShell>{children}</EditShell>;
}
