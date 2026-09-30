export type WorldScreenPoint = Readonly<{ x: number; y: number }>;
export type WorldScreenRect = Readonly<{
	left: number;
	top: number;
	right: number;
	bottom: number;
}>;

export type WorldOffscreenBoundary = "top" | "right" | "bottom" | "left";

export type WorldOffscreenCuePoint = Readonly<{
	x: number;
	y: number;
	boundary: WorldOffscreenBoundary;
}>;

const EPSILON = 1e-7;

export function worldPointInsideRect(
	point: WorldScreenPoint,
	rect: WorldScreenRect,
): boolean {
	return (
		point.x >= rect.left &&
		point.x <= rect.right &&
		point.y >= rect.top &&
		point.y <= rect.bottom
	);
}

/**
 * Finds where a segment from a visible point to an off-screen point exits the
 * usable canvas rectangle. Inputs are screen/client coordinates.
 */
export function worldOffscreenCuePoint(
	inside: WorldScreenPoint,
	outside: WorldScreenPoint,
	rect: WorldScreenRect,
): WorldOffscreenCuePoint | null {
	if (!worldPointInsideRect(inside, rect) || worldPointInsideRect(outside, rect)) {
		return null;
	}

	const dx = outside.x - inside.x;
	const dy = outside.y - inside.y;
	const candidates: Array<{
		t: number;
		x: number;
		y: number;
		boundary: WorldOffscreenBoundary;
	}> = [];

	function candidate(
		t: number,
		x: number,
		y: number,
		boundary: WorldOffscreenBoundary,
	) {
		if (t <= EPSILON || t > 1 + EPSILON) return;
		if (
			x < rect.left - EPSILON ||
			x > rect.right + EPSILON ||
			y < rect.top - EPSILON ||
			y > rect.bottom + EPSILON
		) {
			return;
		}
		candidates.push({ t, x, y, boundary });
	}

	if (Math.abs(dx) > EPSILON) {
		const leftT = (rect.left - inside.x) / dx;
		candidate(leftT, rect.left, inside.y + dy * leftT, "left");
		const rightT = (rect.right - inside.x) / dx;
		candidate(rightT, rect.right, inside.y + dy * rightT, "right");
	}
	if (Math.abs(dy) > EPSILON) {
		const topT = (rect.top - inside.y) / dy;
		candidate(topT, inside.x + dx * topT, rect.top, "top");
		const bottomT = (rect.bottom - inside.y) / dy;
		candidate(bottomT, inside.x + dx * bottomT, rect.bottom, "bottom");
	}

	candidates.sort((left, right) => left.t - right.t);
	const first = candidates[0];
	return first
		? { x: first.x, y: first.y, boundary: first.boundary }
		: null;
}

export function worldOffscreenCueTransform(
	boundary: WorldOffscreenBoundary,
): string {
	switch (boundary) {
		case "left":
			return "translate(0, -50%)";
		case "right":
			return "translate(-100%, -50%)";
		case "top":
			return "translate(-50%, 0)";
		case "bottom":
			return "translate(-50%, -100%)";
	}
}
