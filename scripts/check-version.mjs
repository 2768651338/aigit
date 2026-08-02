import { readFile } from "node:fs/promises";
import process from "node:process";

const root = new URL("../", import.meta.url);
const readText = (path) => readFile(new URL(path, root), "utf8");
const readJson = async (path) => JSON.parse(await readText(path));

const [packageJson, packageLock, tauriConfig, cargoToml, cargoLock] = await Promise.all([
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson("src-tauri/tauri.conf.json"),
  readText("src-tauri/Cargo.toml"),
  readText("src-tauri/Cargo.lock"),
]);

const cargoPackage = cargoToml.match(
  /^\[package\][\s\S]*?^name\s*=\s*"aigit"[\s\S]*?^version\s*=\s*"([^"]+)"/m,
);
const lockPackage = cargoLock.match(
  /^\[\[package\]\][\s\S]*?^name\s*=\s*"aigit"[\s\S]*?^version\s*=\s*"([^"]+)"/m,
);

if (!cargoPackage || !lockPackage) {
  console.error("Could not find the aigit package version in Cargo metadata.");
  process.exit(1);
}

const versions = new Map([
  ["package.json", packageJson.version],
  ["package-lock.json", packageLock.version],
  ["package-lock.json root package", packageLock.packages?.[""]?.version],
  ["src-tauri/Cargo.toml", cargoPackage[1]],
  ["src-tauri/Cargo.lock", lockPackage[1]],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
]);
const expected = packageJson.version;
const mismatches = [...versions].filter(([, version]) => version !== expected);

if (mismatches.length > 0) {
  console.error(`Version mismatch; expected ${expected}:`);
  for (const [source, version] of mismatches) {
    console.error(`- ${source}: ${String(version)}`);
  }
  process.exit(1);
}

console.log(`All project versions match: ${expected}`);
