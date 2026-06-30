#!/usr/bin/env tsx
/**
 * Settings-write loop E2E proof (no DB / no OpenRouter).
 * Run: npm run test:settings-write-loop
 */
import assert from "node:assert/strict";
import { createId } from "@paralleldrive/cuid2";
import { createEmptyBrandKitData } from "../lib/brandKit/defaults";
import {
  applySettingsPatches,
  cloneSnapshot,
  extractPathsSnapshot,
  getAtPath,
  revertChangelogEntry,
  snapshotsEqual,
} from "../lib/brandKit/settingsPatch";
import { normalizeBrandKitData } from "../lib/brandKit/types";

function log(step: string, ok: boolean, detail?: string) {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${step}${detail ? ` — ${detail}` : ""}`);
}

function testPathUtilities() {
  console.log("\n1. Path utilities");
  const kit = createEmptyBrandKitData();
  kit.productNotes = { "Zoomlock Max": "No torch imagery" };

  const r = applySettingsPatches(kit, [{ path: "productNotes/Zoomlock Max", value: "Updated note" }], {
    summary: "test",
    source: "user",
  });
  assert(r.ok);
  assert.equal(getAtPath(r.kit, "productNotes/Zoomlock Max"), "Updated note");
  log("slash path with spaces", true);
}

function testApplyAndChangelog() {
  console.log("\n2. Apply patch + changelog entry");
  const kit = normalizeBrandKitData(createEmptyBrandKitData());
  const beforeSnapshot = cloneSnapshot(kit);

  const prefId = createId();
  const patches = [
    {
      path: "avoidColors",
      value: ["yellow", "purple"],
    },
    {
      path: "clientPreferences",
      value: [
        {
          id: prefId,
          date: "2026-06-26",
          scope: "client",
          note: "Never use yellow or purple anywhere.",
        },
      ],
    },
    {
      path: "productNotes/Zoomlock Max",
      value: "No torch, no braze imagery.",
    },
  ];

  const applied = applySettingsPatches(kit, patches, {
    summary: "Add color avoid list and Zoomlock guardrail",
    source: "agent",
  });

  assert(applied.ok, applied.ok ? "" : applied.error);
  assert.equal(applied.entry.patches.length, 3);
  assert.equal(applied.kit.settingsChangelog.length, 1);
  assert.deepEqual(applied.kit.avoidColors, ["yellow", "purple"]);
  assert.equal(applied.kit.clientPreferences.length, 1);
  assert.equal(getAtPath(applied.kit, "productNotes/Zoomlock Max"), "No torch, no braze imagery.");

  for (const p of applied.entry.patches) {
    assert(p.path.length > 0, "patch path recorded");
    assert(!snapshotsEqual(p.before, p.after), `before !== after for ${p.path}`);
  }

  log("apply creates changelog with before/after", true);
  return { beforeSnapshot, applied };
}

function testByteForByteRevert(ctx: {
  beforeSnapshot: ReturnType<typeof createEmptyBrandKitData>;
  applied: Extract<ReturnType<typeof applySettingsPatches>, { ok: true }>;
}) {
  console.log("\n3. Revert restores exact before snapshot");

  const paths = ctx.applied.entry.patches.map((p) => p.path);
  const beforePaths = extractPathsSnapshot(ctx.beforeSnapshot, paths);
  const midPaths = extractPathsSnapshot(ctx.applied.kit, paths);

  assert(!snapshotsEqual(beforePaths, midPaths), "kit changed after apply");

  const reverted = revertChangelogEntry(ctx.applied.kit, ctx.applied.entry.id);
  assert(reverted.ok, reverted.ok ? "" : reverted.error);
  assert(reverted.entry.revertedAt, "revertedAt set");

  const afterRevertPaths = extractPathsSnapshot(reverted.kit, paths);
  assert(
    snapshotsEqual(beforePaths, afterRevertPaths),
    `byte-for-byte mismatch:\n  before: ${JSON.stringify(beforePaths)}\n  after:  ${JSON.stringify(afterRevertPaths)}`
  );

  // Full kit compare for affected paths + changelog metadata
  assert.equal(reverted.kit.avoidColors.length, 0);
  assert.equal(reverted.kit.clientPreferences.length, 0);
  assert.equal(getAtPath(reverted.kit, "productNotes/Zoomlock Max"), undefined);

  log("byte-for-byte path restore", true);
  return reverted.kit;
}

function testIdempotentSecondRevert(kit: ReturnType<typeof createEmptyBrandKitData>) {
  console.log("\n4. Second revert rejected (idempotent)");

  const entryId = kit.settingsChangelog[0]!.id;
  const second = revertChangelogEntry(kit, entryId);
  assert(!second.ok);
  assert.match(second.error, /already reverted/i);

  log("second revert rejected", true, second.error);
}

function testUnknownEntry() {
  console.log("\n5. Unknown entry rejected");
  const kit = createEmptyBrandKitData();
  const result = revertChangelogEntry(kit, "nonexistent");
  assert(!result.ok);
  log("unknown entry rejected", true);
}

function testNormalizeBackwardCompat() {
  console.log("\n6. normalizeBrandKitData backward compat (legacy kit without new fields)");
  const legacy = normalizeBrandKitData({
    businessName: "Acme",
    colors: [{ name: "blue", hex: "#0000FF" }],
  });
  assert(Array.isArray(legacy.clientPreferences));
  assert.equal(legacy.clientPreferences.length, 0);
  assert.deepEqual(legacy.productNotes, {});
  assert(Array.isArray(legacy.settingsChangelog));
  log("legacy kit normalizes new fields", true);
}

function main() {
  console.log("Settings-write loop E2E proof\n" + "=".repeat(40));

  testPathUtilities();
  const ctx = testApplyAndChangelog();
  const revertedKit = testByteForByteRevert(ctx);
  testIdempotentSecondRevert(revertedKit);
  testUnknownEntry();
  testNormalizeBackwardCompat();

  console.log("\n" + "=".repeat(40));
  console.log("All checks passed.\n");
}

main();
