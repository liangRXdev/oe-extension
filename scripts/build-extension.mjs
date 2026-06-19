import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
// Windows absolute paths (C:\...) aren't valid ESM import URLs; convert to file://.
const manifest = await import(pathToFileURL(join(root, "manifest.json")).href, {
  with: { type: "json" }
});
const version = manifest.default.version;
const distDir = join(root, "dist");
const extensionDir = join(distDir, "extension");
const zipPath = join(distDir, `oe-extension-v${version}.zip`);

await rm(distDir, { recursive: true, force: true });
await mkdir(extensionDir, { recursive: true });

for (const path of ["manifest.json", "src", "icons", "README.md", "LICENSE"]) {
  if (existsSync(join(root, path))) {
    await cp(join(root, path), join(extensionDir, path), { recursive: true });
  }
}

try {
  execFileSync("zip", ["-qr", zipPath, "."], { cwd: extensionDir, stdio: "inherit" });
  console.log(`Built ${zipPath}`);
} catch (error) {
  if (error.code === "ENOENT") {
    // `zip` isn't on PATH (common on Windows). The unpacked folder is enough for
    // local "Load unpacked"; only distribution needs the archive.
    console.log(`Built ${extensionDir} (skipped zip: 'zip' not found on PATH)`);
  } else {
    throw error;
  }
}
