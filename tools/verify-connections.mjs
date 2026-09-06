import { createClient } from "@supabase/supabase-js";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
	throw Error("Supabase configuration missing");
const db = createClient(
	process.env.SUPABASE_URL,
	process.env.SUPABASE_SECRET_KEY,
	{ auth: { persistSession: false, autoRefreshToken: false } },
);
const { count, error } = await db
	.from("sessions")
	.select("source_session_id,campaigns!inner(slug)", {
		count: "exact",
		head: true,
	})
	.eq("status", "published")
	.eq("campaigns.slug", "yuhara-main");
if (error) throw Error(`Supabase read failed: ${error.code}`);
console.log(`SUPABASE_PUBLISHED_COUNT=${count}`);
if (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
	const client = new S3Client({
		region: "auto",
		endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: process.env.R2_ACCESS_KEY_ID,
			secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
		},
	});
	for (const Bucket of [
		process.env.R2_PUBLIC_BUCKET,
		process.env.R2_PRIVATE_BUCKET,
	]) {
		const result = await client.send(
			new ListObjectsV2Command({ Bucket, MaxKeys: 1 }),
		);
		console.log(`R2_BUCKET_READ_OK ${Bucket} objectsSample=${result.KeyCount}`);
	}
} else console.log("R2_CREDENTIALS_PENDING");
