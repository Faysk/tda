"use client";

import { useState } from "react";
import type {
	LoreIdentityDTO,
	LoreNarrationDTO,
	LorePresentation,
} from "../model";
import { LoreCinematicHero } from "./lore-cinematic-hero";
import { LoreNarrationPlayer } from "./lore-narration-player";

type LoreExperienceProps = {
	identity: LoreIdentityDTO;
	presentation: LorePresentation;
	narration?: LoreNarrationDTO;
};

export function LoreExperience({
	identity,
	presentation,
	narration,
}: LoreExperienceProps) {
	const [sceneId, setSceneId] = useState<string | null>(
		presentation.hero.initialSceneId ?? presentation.scenes[0]?.id ?? null,
	);

	return (
		<>
			<LoreCinematicHero
				identity={identity}
				presentation={presentation}
				activeSceneId={sceneId}
			/>
			{narration ? (
				<LoreNarrationPlayer narration={narration} onSceneChange={setSceneId} />
			) : null}
		</>
	);
}
