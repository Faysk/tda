import { spawnSync } from "node:child_process";
import process from "node:process";

const workspace = process.cwd();
const mount = `${workspace}:/workspace`;

const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    mount,
    "-w",
    "/workspace",
    "postgres:16-alpine",
    "python3",
    "tools/campaign-registry-db.py",
  ],
  {
    stdio: "inherit",
    shell: false,
  },
);

if (result.error) {
  console.error(`Failed to start Docker campaign registry check: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
