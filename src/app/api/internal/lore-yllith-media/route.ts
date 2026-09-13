import { createHash, timingSafeEqual } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_BUCKET = "tda-media-public";
const PUBLIC_ORIGIN = "https://media.dnd.faysk.dev";
const SITE_FILES = new Set(["index.html", "yllith.css", "yllith.js", "favicon.svg", "historia.md"]);

const assets = {
	"backgroud_jornada.avif": [44678, "04ae4968021a938e8a8e738bbe84fea20f8e0900bba0be2b6cba70bc635e06b5", "image/avif"],
	"despedida_pais_background.avif": [43481, "f096873034fe4cd14c1cfd24849dcf2fa127bcd65964dc9dd244846a7487421e", "image/avif"],
	"despedida_pais_destaque.avif": [46697, "025d9245cb769525756e7fc9511257d22617905524c4c1c6764dce4fc4cbed86", "image/avif"],
	"despedida_tios_backgroud.avif": [42002, "6e094723afb19b7be52115ecccfc291d699ead15e66bdea688befef07638c803", "image/avif"],
	"despedida_tios_destaque-personagem.avif": [33161, "b065a145edf1f07651a49624bbd3be0740e0e167557a23fcba3a47990460f2bc", "image/avif"],
	"jornada.avif": [52590, "e14ea119456bdd8688d96c6d9f854f90493480f6bedc6a1d1f871610904b3575", "image/avif"],
	"maos_sobre_mapa_matilha.avif": [16734, "585df10d13dfbb442d9a12daafe22b1589c99c4397fd560f2b7911e8e3a3d4de", "image/avif"],
	"mapa_matilha_sem_mao.avif": [84082, "84e87577d93d06b69e9b5d9ff644e2d860cae32ee4542b8e0a7c523124c6850c", "image/avif"],
	"sonho-paralax_personagem.avif": [20734, "0a6d758ad05a37b84040e7548dbf693612fd55c4272f1f0a018a902213e1cca2", "image/avif"],
	"sonho_paralax_backgroud.avif": [16786, "bcf5985f7f43bb50e40d36fc40a6e35192343cf39d9159a479ad0a62f3bab655", "image/avif"],
	"sonho_paralax_espirito.avif": [13665, "650c460bad660ecb35184f1208771ec8659103735bdd797d1a7583369d7756da", "image/avif"],
	"sonho_paralax_nevoa.avif": [14532, "dcfd8cfb7c1ab21a47a4441e34497935de06865140e0f79a56a9c0d63ea5cbb2", "image/avif"],
	"yllith.avif": [73407, "d8d2f723883922f2b31682d946e4278bbe178c7ad769b69cf08cd2ed4eaca288", "image/avif"],
	"yllith_jornada.avif": [33469, "92b5a5922c776170d251afa3190e33e62aab1fb6e1cd9465df437129608a8cad", "image/avif"],
	"social-yllith.jpg": [95942, "3b01721eadeeed0d0c89a72b3a9ed4131f4b3bfc1a7fe936b9a5de2817733258", "image/jpeg"],
	"index.html": [56047, "d37439c16dd24a39c98347e20bc76532ae75a7b09889b7aa1eb653bd4bef934a", "text/html; charset=utf-8"],
	"yllith.css": [37831, "7b0440db4e7f609ab25f6e6a6c22ee393866ff2ddf542e5cbfe18910095f76ae", "text/css; charset=utf-8"],
	"yllith.js": [13080, "0700e3d8c1819770b70fefcb0daeed4ec18b88f52d632ba0a9c9d52a55a98b67", "text/javascript; charset=utf-8"],
	"favicon.svg": [585, "e1a0be3b542499177cb57526e0a0e58d1210a5aea99a3fd6d6f61a2b416d24c6", "image/svg+xml"],
	"historia.md": [16297, "33ca13c18381a977caf86c68af5f7c5c1801e9eeb6e6aca097e17d8ca1de19b1", "text/markdown; charset=utf-8"],
} as const;

type AssetName = keyof typeof assets;

function isConfigured() {
	return Boolean(
		process.env.R2_PUBLIC_BUCKET === PUBLIC_BUCKET &&
		process.env.R2_ACCOUNT_ID &&
		process.env.R2_ACCESS_KEY_ID &&
		process.env.R2_SECRET_ACCESS_KEY,
	);
}

function isProductionAuthorized(request: Request) {
	if (process.env.APP_ENV !== "production") return true;
	const expected = process.env.TDA_LORE_STAGING_TOKEN?.trim();
	const authorization = request.headers.get("authorization");
	if (!expected || !authorization?.startsWith("Bearer ")) return false;
	const provided = authorization.slice("Bearer ".length).trim();
	const providedBytes = Buffer.from(provided, "utf8");
	const expectedBytes = Buffer.from(expected, "utf8");
	return (
		providedBytes.length === expectedBytes.length &&
		timingSafeEqual(providedBytes, expectedBytes)
	);
}

function objectKey(name: AssetName) {
	const [, sha256] = assets[name];
	return SITE_FILES.has(name)
		? `lore/yllith/site/${name}`
		: `lore/yllith/${sha256}/${name}`;
}

function publicUrl(name: AssetName) {
	return `${PUBLIC_ORIGIN}/${objectKey(name)}`;
}

export async function GET() {
	return Response.json({
		environment: process.env.APP_ENV ?? null,
		configured: isConfigured(),
		assets: (Object.keys(assets) as AssetName[]).map((name) => ({
			name,
			url: publicUrl(name),
		})),
	});
}

export async function POST(request: Request) {
	if (!["preview", "production"].includes(process.env.APP_ENV ?? ""))
		return Response.json({ error: "release-staging endpoint" }, { status: 404 });
	if (!isProductionAuthorized(request))
		return Response.json({ error: "release-staging endpoint" }, { status: 404 });
	if (!isConfigured())
		return Response.json({ error: "R2 configuration unavailable" }, { status: 503 });
	const name = new URL(request.url).searchParams.get("file") as AssetName | null;
	if (!name || !(name in assets))
		return Response.json({ error: "unknown asset" }, { status: 400 });
	const [expectedBytes, expectedSha256, contentType] = assets[name];
	const bytes = Buffer.from(await request.arrayBuffer());
	if (bytes.length !== expectedBytes)
		return Response.json({ error: "byte length mismatch" }, { status: 422 });
	const digest = createHash("sha256").update(bytes).digest("hex");
	if (digest !== expectedSha256)
		return Response.json({ error: "sha256 mismatch" }, { status: 422 });
	const client = new S3Client({
		region: "auto",
		endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: process.env.R2_ACCESS_KEY_ID!,
			secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
		},
		requestChecksumCalculation: "WHEN_REQUIRED",
	});
	const key = objectKey(name);
	await client.send(
		new PutObjectCommand({
			Bucket: PUBLIC_BUCKET,
			Key: key,
			Body: bytes,
			ContentType: contentType,
			CacheControl: SITE_FILES.has(name)
				? "public, max-age=300, must-revalidate"
				: "public, max-age=31536000, immutable",
		}),
	);
	return Response.json({
		ok: true,
		name,
		sha256: digest,
		bytes: bytes.length,
		key,
		url: publicUrl(name),
	});
}
