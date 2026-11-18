import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = path.resolve(workerDir, "..");
const args = process.argv.slice(2);
const deploy = args.includes("--deploy");
const fileFlag = args.indexOf("--file");
const credentialsPath = path.resolve(
  projectDir,
  fileFlag >= 0
    ? args[fileFlag + 1] ?? ""
    : "hyperdatalab-researchhub-firebase-adminsdk-fbsvc-d600e46b27.json",
);

if (fileFlag >= 0 && !args[fileFlag + 1]) {
  throw new Error("Pass a JSON file path after --file.");
}

const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
if (
  typeof credentials.client_email !== "string" ||
  typeof credentials.private_key !== "string" ||
  typeof credentials.project_id !== "string"
) {
  throw new Error("The service account JSON is missing project_id, client_email, or private_key.");
}

const wranglerConfigPath = path.join(workerDir, "wrangler.jsonc");
const wranglerConfig = JSON.parse(readFileSync(wranglerConfigPath, "utf8"));
if (credentials.project_id !== wranglerConfig.vars?.FIREBASE_PROJECT_ID) {
  throw new Error("The service account JSON belongs to a different Firebase project than the Worker.");
}

const localVarsPath = path.join(workerDir, ".dev.vars");
const currentVars = readFileSync(localVarsPath, "utf8");
const values = {
  FIREBASE_CLIENT_EMAIL: credentials.client_email,
  FIREBASE_PRIVATE_KEY: credentials.private_key,
};
let nextVars = currentVars;
for (const [key, value] of Object.entries(values)) {
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  nextVars = pattern.test(nextVars)
    ? nextVars.replace(pattern, line)
    : `${nextVars}${nextVars.endsWith("\n") || nextVars.length === 0 ? "" : "\n"}${line}\n`;
}
const localTempPath = `${localVarsPath}.${process.pid}.tmp`;
writeFileSync(localTempPath, nextVars, { mode: 0o600 });
renameSync(localTempPath, localVarsPath);
console.log("Loaded Firebase service account into worker/.dev.vars.");

if (!deploy) {
  console.log("Local Worker secrets are ready. No Cloudflare deployment was made.");
  process.exit(0);
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "research-hub-worker-secrets-"));
const secretsPath = path.join(tempDir, "secrets.json");
try {
  writeFileSync(secretsPath, JSON.stringify(values), { mode: 0o600 });
  const wranglerPath = path.join(projectDir, "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(
    process.execPath,
    [wranglerPath, "secret", "bulk", secretsPath, "--config", "worker/wrangler.jsonc"],
    { cwd: projectDir, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else console.log("Uploaded the Firebase secrets to the deployed Worker.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
