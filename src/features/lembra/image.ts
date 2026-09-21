import { createHash } from "node:crypto";
import {
	LEMBRA_MAX_BYTES,
	LEMBRA_MAX_DIMENSION,
	type LembraExtension,
	type LembraMediaMime,
} from "./model";

export type LembraImageInfo = Readonly<{
	sha256: string;
	mimeType: LembraMediaMime;
	extension: LembraExtension;
	bytes: number;
	width: number;
	height: number;
}>;

function failure(code: string): never {
	throw new Error(`LEMBRA_MEDIA_${code}`);
}

export function lembraSha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function validDimensions(width: number, height: number): boolean {
	return (
		Number.isSafeInteger(width) &&
		Number.isSafeInteger(height) &&
		width >= 1 &&
		height >= 1 &&
		width <= LEMBRA_MAX_DIMENSION &&
		height <= LEMBRA_MAX_DIMENSION
	);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const chunk = Buffer.from(bytes.subarray(offset, offset + 4)).toString("ascii");
		const size = Buffer.from(bytes.subarray(offset + 4, offset + 8)).readUInt32LE(0);
		const data = offset + 8;
		if (data + size > bytes.length) return null;

		if (chunk === "VP8X" && size >= 10) {
			return {
				width: readUint24LE(bytes, data + 4) + 1,
				height: readUint24LE(bytes, data + 7) + 1,
			};
		}
		if (
			chunk === "VP8 " &&
			size >= 10 &&
			bytes[data + 3] === 0x9d &&
			bytes[data + 4] === 0x01 &&
			bytes[data + 5] === 0x2a
		) {
			return {
				width: (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff,
				height: (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff,
			};
		}
		if (chunk === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
			const b1 = bytes[data + 1];
			const b2 = bytes[data + 2];
			const b3 = bytes[data + 3];
			const b4 = bytes[data + 4];
			return {
				width: 1 + (((b2 & 0x3f) << 8) | b1),
				height:
					1 +
					(((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
			};
		}

		offset = data + size + (size % 2);
	}
	return null;
}

const JPEG_SOF_MARKERS = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let offset = 2;

	while (offset + 3 < bytes.length) {
		if (bytes[offset] !== 0xff) {
			offset += 1;
			continue;
		}
		while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
		if (offset >= bytes.length) return null;

		const marker = bytes[offset];
		offset += 1;
		if (marker === 0xd8 || marker === 0xd9) continue;
		if (marker === 0xda) return null;
		if (offset + 2 > bytes.length) return null;

		const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
		if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;

		if (JPEG_SOF_MARKERS.has(marker)) {
			if (segmentLength < 7) return null;
			return {
				height: (bytes[offset + 3] << 8) | bytes[offset + 4],
				width: (bytes[offset + 5] << 8) | bytes[offset + 6],
			};
		}
		offset += segmentLength;
	}
	return null;
}

export function inspectLembraImage(bytes: Uint8Array): LembraImageInfo {
	if (bytes.length < 24 || bytes.length > LEMBRA_MAX_BYTES) failure("INVALID_SIZE");

	const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
	if (Buffer.from(bytes.subarray(0, 8)).equals(pngSignature)) {
		if (
			Buffer.from(bytes.subarray(12, 16)).toString("ascii") !== "IHDR" ||
			Buffer.from(bytes.subarray(8, 12)).readUInt32BE(0) !== 13
		) {
			failure("INVALID_PNG");
		}
		const width = Buffer.from(bytes.subarray(16, 20)).readUInt32BE(0);
		const height = Buffer.from(bytes.subarray(20, 24)).readUInt32BE(0);
		if (!validDimensions(width, height)) failure("INVALID_DIMENSIONS");
		return {
			sha256: lembraSha256(bytes),
			mimeType: "image/png",
			extension: "png",
			bytes: bytes.length,
			width,
			height,
		};
	}

	const isWebp =
		Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
		Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
	if (isWebp) {
		const declaredSize = Buffer.from(bytes.subarray(4, 8)).readUInt32LE(0) + 8;
		if (declaredSize !== bytes.length) failure("INVALID_WEBP");
		const dimensions = webpDimensions(bytes);
		if (!dimensions || !validDimensions(dimensions.width, dimensions.height)) {
			failure("INVALID_DIMENSIONS");
		}
		return {
			sha256: lembraSha256(bytes),
			mimeType: "image/webp",
			extension: "webp",
			bytes: bytes.length,
			width: dimensions.width,
			height: dimensions.height,
		};
	}

	const jpeg = jpegDimensions(bytes);
	if (jpeg) {
		if (!validDimensions(jpeg.width, jpeg.height)) failure("INVALID_DIMENSIONS");
		return {
			sha256: lembraSha256(bytes),
			mimeType: "image/jpeg",
			extension: "jpg",
			bytes: bytes.length,
			width: jpeg.width,
			height: jpeg.height,
		};
	}

	failure("UNSUPPORTED_IMAGE");
}
