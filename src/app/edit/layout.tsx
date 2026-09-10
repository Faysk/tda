import type { Metadata } from "next";
import { EditShell } from "@/features/edit/shell/edit-shell";

export const metadata: Metadata = {
	robots: {
		index: false,
		follow: false,
	},
};

export default function EditLayout({ children }: { children: React.ReactNode }) {
	return <EditShell>{children}</EditShell>;
}
