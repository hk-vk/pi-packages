import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagesDir = join(root, "packages");
const jiti = createJiti(import.meta.url);

function sourceFiles(packageDir, resource) {
  const target = join(packageDir, resource);
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  const entries = readdirSync(target, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(target, entry.name);
    if (entry.isDirectory()) return sourceFiles(packageDir, join(resource, entry.name));
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

for (const dir of readdirSync(packagesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
  const packageDir = join(packagesDir, dir);
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const files = manifest.pi.extensions.flatMap((resource) => sourceFiles(packageDir, resource));
  assert.ok(files.length > 0, `${dir}: no TypeScript extension files found`);

  for (const file of files) {
    const module = await jiti.import(file, { default: true });
    assert.equal(typeof module, "function", `${dir}: ${file} must export an extension factory`);
  }

  console.log(`extension load ok: ${manifest.name}`);
}
