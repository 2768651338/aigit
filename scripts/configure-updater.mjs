import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const endpoint = process.env.UPDATER_ENDPOINT?.trim();
const pubkey = process.env.UPDATER_PUBKEY?.trim();
const hasSigningKey = process.env.SIGNING_KEY_CONFIGURED === "true";
const provided = [Boolean(endpoint), Boolean(pubkey), hasSigningKey];

if (!provided.some(Boolean)) {
  console.error(
    "Updater configuration is required for release builds: configure TAURI_UPDATER_ENDPOINT, TAURI_UPDATER_PUBKEY, and TAURI_SIGNING_PRIVATE_KEY.",
  );
  process.exit(1);
}

if (!provided.every(Boolean)) {
  console.error(
    "Incomplete updater configuration: endpoint, public key, and signing private key must be configured together.",
  );
  process.exit(1);
}

let parsedEndpoint;
try {
  parsedEndpoint = new URL(endpoint);
} catch {
  console.error("TAURI_UPDATER_ENDPOINT must be a valid URL.");
  process.exit(1);
}

if (parsedEndpoint.protocol !== "https:") {
  console.error("TAURI_UPDATER_ENDPOINT must use HTTPS.");
  process.exit(1);
}

const configUrl = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const config = JSON.parse(await readFile(configUrl, "utf8"));
config.bundle.createUpdaterArtifacts = true;
config.plugins ??= {};
config.plugins.updater = {
  endpoints: [endpoint],
  pubkey,
};

await writeFile(configUrl, `${JSON.stringify(config, null, 2)}\n`);
console.log("Enabled signed updater artifacts for this release build.");
