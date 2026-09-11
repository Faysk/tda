export function nextInspectorMode(mode: "closed" | "overlay" | "docked") {
  if (mode === "closed") return "overlay";
  if (mode === "overlay") return "docked";
  return "closed";
}
