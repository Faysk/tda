import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

/** Server-only R2 client. Authorization belongs to the calling feature boundary. */
export function mediaClient() {
	const account = process.env.R2_ACCOUNT_ID;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	if (!account || !accessKeyId || !secretAccessKey)
		throw new Error("Media connection is not configured");
	if (!/^[a-f0-9]{32}$/.test(account)) throw new Error("Invalid media account");
	return new S3Client({
		region: "auto",
		endpoint: `https://${account}.r2.cloudflarestorage.com`,
		credentials: { accessKeyId, secretAccessKey },
		requestChecksumCalculation: "WHEN_REQUIRED",
	});
}
