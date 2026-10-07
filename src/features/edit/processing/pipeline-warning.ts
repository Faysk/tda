export function presentPipelineWarning(warning: string): string {
	const match = /^QWEN_UNRECOGNIZED_WINDOW:track-(\d+):window-(\d+):(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(warning);
	if (!match) return warning;
	const start = Number(match[3]);
	const end = Number(match[4]);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return warning;
	const timestamp = (seconds: number) => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60].map(value => String(value).padStart(2, "0")).join(":");
	return `Faixa ${match[1]} · ${timestamp(start)}–${timestamp(end)}: trecho sem reconhecimento ignorado. O restante foi processado normalmente.`;
}
