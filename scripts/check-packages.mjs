import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagesDir = join(root, "packages");
const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

assert.ok(packageDirs.length > 0, "no packages found");

for (const dir of packageDirs) {
  const packageDir = join(packagesDir, dir);
  const manifestPath = join(packageDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const relativeDir = relative(root, packageDir);

  assert.match(manifest.name, /^@hk-vk\//, `${dir}: package must use the @hk-vk scope`);
  assert.equal(manifest.private, undefined, `${dir}: publishable packages must not be private`);
  assert.ok(manifest.version, `${dir}: missing version`);
  assert.ok(manifest.description, `${dir}: missing description`);
  assert.equal(manifest.type, "module", `${dir}: must be ESM`);
  assert.ok(manifest.keywords?.includes("pi-package"), `${dir}: missing pi-package keyword`);
  assert.ok(Array.isArray(manifest.pi?.extensions) && manifest.pi.extensions.length > 0, `${dir}: missing pi.extensions`);
  assert.equal(manifest.publishConfig?.access, "public", `${dir}: npm access must be public`);
  assert.equal(manifest.repository?.directory, relativeDir, `${dir}: repository.directory must match its package path`);

  for (const file of manifest.files ?? []) {
    if (file.startsWith("!")) continue;
    const candidate = join(packageDir, file.replace(/\/[*].*$/, ""));
    assert.ok(existsSync(candidate), `${dir}: published path is missing: ${file}`);
  }

  for (const extension of manifest.pi.extensions) {
    assert.ok(existsSync(join(packageDir, extension)), `${dir}: pi extension path is missing: ${extension}`);
  }

  console.log(`manifest ok: ${manifest.name}`);
}
