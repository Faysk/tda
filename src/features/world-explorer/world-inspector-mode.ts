let observer: MutationObserver | null = null;
function dock(value: boolean): boolean {
  const root = document.querySelector<HTMLElement>('[data-world-authoring-active="true"]');
  const panel = root?.querySelector<HTMLElement>('aside[aria-live="polite"]');
  if (!root || !panel) return false;
  observer?.disconnect();
  observer = null;
  root.style.removeProperty("grid-template-columns");
  for (const prop of ["position","z-index","width","min-width","max-width","padding","border-left","background","box-shadow","overflow"]) panel.style.removeProperty(prop);
  if (!value || getComputedStyle(root).display !== "grid") return false;
  root.style.gridTemplateColumns = "minmax(0, 1fr) var(--world-inspector-width)";
  Object.assign(panel.style,{position:"relative",zIndex:"20",width:"var(--world-inspector-width)",minWidth:"var(--world-inspector-width)",maxWidth:"var(--world-inspector-width)",padding:"24px",borderLeft:"1px solid var(--ds-control-border)",background:"var(--ds-surface-elevated)",boxShadow:"-14px 0 48px var(--ds-ambient-cool)",overflow:"auto"});
  observer = new MutationObserver(() => {
    if (root.dataset.worldInspectorMode !== "docked" || root.dataset.worldFocusMode === "true" || root.dataset.worldAuthoringActive !== "true") dock(false);
  });
  observer.observe(root,{attributes:true,attributeFilter:["data-world-inspector-mode","data-world-focus-mode","data-world-authoring-active"]});
  return true;
}
export function nextInspectorMode(mode: "closed" | "overlay" | "docked") {
  if (mode === "closed") return "overlay" as const;
  if (mode === "overlay") return dock(true) ? "docked" as const : "closed" as const;
  dock(false);
  return "closed" as const;
}
