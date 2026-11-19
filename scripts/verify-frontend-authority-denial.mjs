#!/usr/bin/env node
// Isolated, read-only diagnostic. This does NOT certify Mongo-backed frontend adoption.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(process.argv[2] || "frontend");
const file = join(root, "scripts/verify-movie-mentor-conversation-continuity.mjs");
const original = readFileSync(file, "utf8");
const assertion = "assert.equal(cleared.acquired, true);";
assert.equal(original.split(assertion).length - 1, 1, "Original regression assertion must remain unique");
const temp = mkdtempSync(join(tmpdir(), "mm-authority-denial-"));
try {
  // Place a diagnostic sibling in the original source tree to preserve import resolution.
  const diagnostic = join(root, "scripts/verify-movie-mentor-authority-denial-isolated.mjs");
  const { existsSync, unlinkSync } = await import("node:fs");
  assert.equal(existsSync(diagnostic), false, "Refuse to overwrite an existing verifier");
  try {
    writeFileSync(diagnostic, original.replace(assertion,
      'console.log("AUTHORITY_DENIAL_EVIDENCE", JSON.stringify(cleared));\n' + assertion));
    const result = spawnSync(process.execPath, [diagnostic], { encoding: "utf8", cwd: root });
    const output = result.stdout + "\n" + result.stderr;
    const match = result.stdout.match(/^AUTHORITY_DENIAL_EVIDENCE (\{[^\n]+\})$/m);
    assert.ok(match, "Denial reason must be observed from actual runtime execution");
    const denial = JSON.parse(match[1]);
    assert.deepEqual(denial, { acquired: false, reason: "publication-outbox-provenance-unverified" });
    assert.notEqual(result.status, 0, "Original unchanged assertion must remain RED");
    assert.match(output, /AssertionError/);
    console.log("GREEN ORIGINAL_ASSERTION_RED_PRESERVED");
    console.log("GREEN EXACT_PROVENANCE_DENIAL_CAPTURED");
    console.log("HELD FRONTEND_TO_MONGO_AUTHORITY_INTEGRATION_NOT_CERTIFIED");
  } finally {
    if (existsSync(diagnostic)) unlinkSync(diagnostic);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
