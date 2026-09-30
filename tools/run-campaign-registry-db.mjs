import { spawnSync } from "node:child_process";
import process from "node:process";

const workspace = process.cwd();
const mount = `${workspace}:/workspace`;

// postgres:16-alpine intentionally stays our only persistent Docker image.
// Python is installed into the writable layer of this --rm container only,
// then disappears with the container after the contract finishes.
const command = "apk add --no-cache python3 >/dev/null && python3 tools/campaign-registry-db.py";

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
    "sh",
    "-lc",
    command,
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
