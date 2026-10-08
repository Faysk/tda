/** Keep small chunked evidence downloads automatic without buffering large ZIPs. */
export async function prepareEvidenceDownload(
	body: ReadableStream<Uint8Array<ArrayBuffer>>,
	limit: number,
): Promise<
	| { blob: Blob; stream: null }
	| { blob: null; stream: ReadableStream<Uint8Array<ArrayBuffer>> }
> {
	if (!Number.isSafeInteger(limit) || limit < 0)
		throw new Error("Invalid download limit");
	const reader = body.getReader();
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let size = 0;
	try {
		while (size <= limit) {
			const next = await reader.read();
			if (next.done) return { blob: new Blob(chunks), stream: null };
			chunks.push(new Uint8Array(next.value));
			size += next.value.byteLength;
		}
	} catch (cause) {
		await reader.cancel().catch(() => {});
		throw cause;
	}
	return {
		blob: null,
		stream: new ReadableStream<Uint8Array<ArrayBuffer>>({
			async pull(controller) {
				const buffered = chunks.shift();
				if (buffered) {
					controller.enqueue(buffered);
					return;
				}
				const next = await reader.read();
				if (next.done) controller.close();
				else controller.enqueue(next.value);
			},
			cancel(reason) {
				chunks.length = 0;
				return reader.cancel(reason);
			},
		}),
	};
}
