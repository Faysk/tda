"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LoreNarrationDTO } from "../model";
import { findActiveLoreBeat, loreNarrationEndMs, loreNarrationWebVtt } from "../timeline";
import styles from "./lore-narration-player.module.css";

type LoreNarrationPlayerProps = {
	narration: LoreNarrationDTO;
	onSceneChange?: (sceneId: string | null) => void;
};

function formatClock(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	const remainder = String(seconds % 60).padStart(2, "0");
	return `${minutes}:${remainder}`;
}

export function LoreNarrationPlayer({
	narration,
	onSceneChange,
}: LoreNarrationPlayerProps) {
	const audioRef = useRef<HTMLAudioElement>(null);
	const captionsSrc = useMemo(
		() => `data:text/vtt;charset=utf-8,${encodeURIComponent(loreNarrationWebVtt(narration))}`,
		[narration],
	);
	const [currentMs, setCurrentMs] = useState(0);
	const [durationMs, setDurationMs] = useState(
		narration.durationMs ?? loreNarrationEndMs(narration),
	);
	const [playing, setPlaying] = useState(false);
	const activeBeat = useMemo(
		() => findActiveLoreBeat(narration.beats, currentMs),
		[narration.beats, currentMs],
	);

	useEffect(() => {
		onSceneChange?.(activeBeat?.sceneId ?? null);
	}, [activeBeat?.sceneId, onSceneChange]);

	const togglePlayback = async () => {
		const audio = audioRef.current;
		if (!audio) return;
		if (audio.paused) {
			try {
				await audio.play();
			} catch {
				setPlaying(false);
			}
		} else {
			audio.pause();
		}
	};

	const seek = (nextMs: number) => {
		const audio = audioRef.current;
		if (!audio) return;
		const bounded = Math.max(0, Math.min(nextMs, durationMs || nextMs));
		audio.currentTime = bounded / 1000;
		setCurrentMs(bounded);
	};

	return (
		<section className={styles.player} aria-label="Narração da lore">
		<audio
			ref={audioRef}
			src={narration.src}
			preload="metadata"
			onLoadedMetadata={(event) => {
				const measured = event.currentTarget.duration * 1000;
				if (Number.isFinite(measured) && measured > 0) setDurationMs(measured);
			}}
			onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
			onPlay={() => setPlaying(true)}
			onPause={() => setPlaying(false)}
			onEnded={() => setPlaying(false)}
		>
			<track kind="captions" src={captionsSrc} srcLang="pt-BR" label="Português" default />
		</audio>

		<div className={styles.controls}>
			<button type="button" onClick={togglePlayback} aria-pressed={playing}>
				{playing ? "Pausar" : "Ouvir história"}
			</button>
			<label className={styles.timeline}>
				<span className={styles.srOnly}>Posição da narração</span>
				<input
					type="range"
					min={0}
					max={Math.max(1, Math.round(durationMs))}
					value={Math.min(Math.round(currentMs), Math.max(1, Math.round(durationMs)))}
					onChange={(event) => seek(Number(event.currentTarget.value))}
				/>
			</label>
			<output className={styles.clock}>
				{formatClock(currentMs)} / {formatClock(durationMs)}
			</output>
		</div>

		<div className={styles.caption} aria-live="polite" aria-atomic="true">
			{activeBeat?.subtitle ?? " "}
		</div>
	</section>
	);
}
