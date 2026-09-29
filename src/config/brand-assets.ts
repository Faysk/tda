export const TDA_BRAND_MEDIA_ORIGIN = "https://media.dnd.faysk.dev";

export const TDA_BRAND_ASSETS = {
	favicon:
		"https://media.dnd.faysk.dev/brand/59d3f1be2c9569afddbae6a944eb023bd2327a06ebfec12bfa28d83def7e149e/favicon.svg",
	iconDuckBlack:
		"https://media.dnd.faysk.dev/brand/10ccb252143ebb50e57de27d9704cf801d6811f4bd21e290a31d56ac4ae6f6f6/tda-icon-duck-black.svg",
	iconDuckWhite:
		"https://media.dnd.faysk.dev/brand/8702b24c58d28fa5f217531edd6fd458333a88f26fd14662e6f8ca190882cdac/tda-icon-duck-white.svg",
	markBlack:
		"https://media.dnd.faysk.dev/brand/66c5dbe83c07b08e6355230c255ee98fd27f4ef1ce93e4de2cce239e9217a5ec/tda-mark-black.svg",
	markWhite:
		"https://media.dnd.faysk.dev/brand/8474cd455cb5b6ffc254ed5ca5c3c5aa1b25f64ec8e694ed85ce1eea8b2d83ff/tda-mark-white.svg",
} as const;

export type TdaBrandAssetKey = keyof typeof TDA_BRAND_ASSETS;
