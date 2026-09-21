import type { Metadata } from "next";
import { LembraExperience } from "@/features/lembra/components/lembra-experience";

export const metadata: Metadata = {
	title: "Lembra",
	description:
		"Referências visuais compartilhadas para guardar e reencontrar ideias da campanha.",
};

export default function LembraPage() {
	return <LembraExperience />;
}
