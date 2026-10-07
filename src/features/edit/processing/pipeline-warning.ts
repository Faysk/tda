export function presentPipelineWarning(warning: string, recordingNumber?: number): string {
	const scoped = /^[0-9a-f]{32}:(.+)$/.exec(warning);
	const code = scoped?.[1] ?? warning;
	const match = /^QWEN_UNRECOGNIZED_WINDOW:track-(\d+):window-(\d+):(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(code);
	if (!match) return warning;
	const start = Number(match[3]);
	const end = Number(match[4]);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return warning;
	const timestamp = (seconds: number) => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60].map(value => String(value).padStart(2, "0")).join(":");
	return `${recordingNumber === undefined ? "" : `Gravação ${recordingNumber} · `}Faixa ${match[1]} · ${timestamp(start)}–${timestamp(end)}: trecho sem reconhecimento ignorado. O restante foi processado normalmente.`;
}
