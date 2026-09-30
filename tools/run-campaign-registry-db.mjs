import { spawnSync } from "node:child_process";
import process from "node:process";

const workspace = process.cwd();
const mount = `${workspace}:/workspace`;

// postgres:16-alpine intentionally stays our only persistent Docker image.
// The container starts as root only long enough to install Python into its
// disposable writable layer, then the database harness runs as the image's
// unprivileged postgres user. PostgreSQL initdb refuses to run as root.
const command =
  "apk add --no-cache python3 su-exec >/dev/null && " +
  "exec su-exec postgres env TDA_POSTGRES_BIN=/usr/local/bin " +
  "python3 tools/campaign-registry-db.py";

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
