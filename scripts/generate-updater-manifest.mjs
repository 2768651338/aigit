import process from "node:process";
import { generateUpdaterManifest } from "./updater-manifest-lib.mjs";

const [version, endpoint, inputDir, outputDir] = process.argv.slice(2);
if (!version || !endpoint || !inputDir || !outputDir) {
  throw new Error("Usage: node generate-updater-manifest.mjs <version> <endpoint> <input> <output>");
}

const manifest = await generateUpdaterManifest({ version, endpoint, inputDir, outputDir });
const artifactName = new URL(manifest.platforms["windows-x86_64"].url).pathname.split("/").pop();
console.log(`Generated signed updater manifest for ${artifactName}`);
