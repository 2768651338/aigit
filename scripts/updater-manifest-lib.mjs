import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export const WINDOWS_PLATFORM_KEY = "windows-x86_64";

export function validateUpdaterEndpoint(endpoint) {
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Updater endpoint must be a valid URL");
  }
  if (parsed.protocol !== "https:") throw new Error("Updater endpoint must use HTTPS");
  return parsed;
}

export function buildUpdaterManifest({ version, endpoint, artifactName, signature, pubDate = new Date().toISOString() }) {
  if (!version?.trim()) throw new Error("Updater version is required");
  if (!artifactName?.endsWith(".nsis.zip")) throw new Error("Updater artifact must be an NSIS updater zip");
  if (!signature?.trim()) throw new Error("Updater signature is empty");
  const base = validateUpdaterEndpoint(endpoint);
  const artifactBase = base.pathname.endsWith("/") ? base : new URL(".", base);
  const url = new URL(artifactName, artifactBase);
  if (url.origin !== base.origin) throw new Error("Updater artifact URL must use the endpoint origin");
  return {
    version,
    notes: `aigit ${version}`,
    pub_date: pubDate,
    platforms: {
      [WINDOWS_PLATFORM_KEY]: { signature: signature.trim(), url: url.href },
    },
  };
}

export async function generateUpdaterManifest({ version, endpoint, inputDir, outputDir }) {
  const files = await readdir(inputDir, { recursive: true, withFileTypes: true });
  const signatures = files.filter((file) => file.isFile() && file.name.endsWith(".nsis.zip.sig"));
  if (signatures.length !== 1) throw new Error(`Expected exactly one signed NSIS updater artifact, found ${signatures.length}`);
  const signatureFile = signatures[0];
  const sigPath = join(signatureFile.parentPath, signatureFile.name);
  const artifactPath = sigPath.slice(0, -4);
  const artifactName = basename(artifactPath);
  const signature = await readFile(sigPath, "utf8");
  const manifest = buildUpdaterManifest({ version, endpoint, artifactName, signature });

  await mkdir(outputDir, { recursive: true });
  await copyFile(artifactPath, join(outputDir, artifactName));
  await copyFile(sigPath, join(outputDir, basename(sigPath)));
  await writeFile(join(outputDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
