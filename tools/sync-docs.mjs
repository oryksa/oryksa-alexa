/**
 * One README, two packages.
 *
 * npm and PyPI only ship what is inside the package folder, so each package
 * needs its own copy of README.md and LICENSE. This copies them from the root,
 * which stays the single source, and rewrites the relative links so they still
 * work on a registry page, where there is no repository around them.
 *
 *   node tools/sync-docs.mjs
 *
 * It runs on its own before `npm pack` and `npm publish` (the prepack script),
 * and has to be run by hand before `python -m build`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLOB = "https://github.com/oryksa/oryksa-alexa/blob/main/";

/** A registry page has no repository around it, so relative links die there. */
function absolute(text) {
  return text
    .replace(/\]\(README\.pt\.md\)/g, "](" + BLOB + "README.pt.md)")
    .replace(/\]\(README\.md\)/g, "](" + BLOB + "README.md)")
    .replace(/\]\(interaction-model\)/g, "](" + BLOB + "interaction-model)")
    .replace(/\]\(CHANGELOG\.md\)/g, "](" + BLOB + "CHANGELOG.md)");
}

const readme = absolute(readFileSync(join(root, "README.md"), "utf8"));
const license = readFileSync(join(root, "LICENSE"), "utf8");

for (const pkg of ["node", "python"]) {
  writeFileSync(join(root, pkg, "README.md"), readme);
  writeFileSync(join(root, pkg, "LICENSE"), license);
  console.log("ok " + pkg + "/README.md e " + pkg + "/LICENSE");
}
