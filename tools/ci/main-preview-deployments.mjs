export function trustedMainPreviewDeployments(deployments, sourceSha) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha || "") || !Array.isArray(deployments)) return [];
  return deployments.filter((deployment) =>
    Number.isSafeInteger(deployment?.id) && deployment.id > 0 &&
    deployment.sha === sourceSha && deployment.environment === "preview" &&
    deployment.ref === "main" &&
    deployment.performed_via_github_app?.id === 15368 &&
    deployment.performed_via_github_app?.slug === "github-actions");
}
