import { readFile } from "node:fs/promises";
import process from "node:process";

// Release guard: the updater plugin is pre-authorized in the frontend
// capabilities (check / download-and-install / restart). The moment CI
// injects endpoints, a missing public key would produce a "signed endpoint,
// unsigned verification" half configuration — reject that at build time.

const root = new URL("../", import.meta.url);
const tauriConfig = JSON.parse(
  await readFile(new URL("src-tauri/tauri.conf.json", root), "utf8"),
);

const endpoints = tauriConfig?.plugins?.updater?.endpoints ?? [];
const pubkey = tauriConfig?.plugins?.updater?.pubkey ?? "";

if (endpoints.length > 0 && pubkey.trim() === "") {
  console.error(
    "Updater endpoints are configured but the verification pubkey is empty.\n" +
      "Configure plugins.updater.pubkey together with endpoints, or clear the endpoints.",
  );
  process.exit(1);
}

if (endpoints.length === 0) {
  console.log(
    "Updater endpoints are empty — automatic updates stay disabled (expected for local builds).",
  );
  process.exit(0);
}

const insecure = endpoints.filter((endpoint) => !endpoint.startsWith("https://"));
if (insecure.length > 0) {
  console.error("Updater endpoints must use HTTPS:", insecure.join(", "));
  process.exit(1);
}

console.log(`Updater configured: ${endpoints.length} HTTPS endpoint(s), pubkey present.`);
