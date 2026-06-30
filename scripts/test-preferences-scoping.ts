#!/usr/bin/env tsx
/**
 * Fail-safe preference scoping tests (no DB).
 * Run: npm run test:preferences-scoping
 */
import assert from "node:assert/strict";
import { createEmptyBrandKitData } from "../lib/brandKit/defaults";
import {
  findConfidentProductNoteKey,
  formatPreferencesForPrompt,
  formatProductNotesForPrompt,
} from "../lib/brandKit/preferences";
import type { ClientPreferenceEntry } from "../lib/brandKit/types";

function pref(scope: ClientPreferenceEntry["scope"], note: string): ClientPreferenceEntry {
  return { id: scope + note.slice(0, 8), date: "2026-06-26", scope, note };
}

function testClientOnlyWhenProductAmbiguous() {
  const kit = createEmptyBrandKitData();
  kit.clientPreferences = [
    pref("client", "Client-wide rule"),
    pref("product:Zoomlock Max", "No torch imagery"),
    pref("product:Zoomlock", "Ambiguous sibling rule"),
  ];
  kit.productNotes = {
    "Zoomlock Max": "Press-fit only",
    Zoomlock: "Other product",
  };

  const block = formatPreferencesForPrompt(kit, { product: "Zoomlock Max fittings kit" });
  assert(block.includes("Client-wide rule"));
  assert(!block.includes("No torch imagery"), "ambiguous product scopes excluded");
  assert(!block.includes("Ambiguous sibling"));

  assert.equal(findConfidentProductNoteKey(kit.productNotes, "Zoomlock Max fittings kit"), null);
  assert.equal(formatProductNotesForPrompt(kit, "Zoomlock Max fittings kit"), "");
}

function testConfidentProductMatch() {
  const kit = createEmptyBrandKitData();
  kit.clientPreferences = [
    pref("client", "Client-wide rule"),
    pref("product:Daikin", "Lead with #1 distributor"),
  ];
  kit.productNotes = { Daikin: "Local stock, VRV, ductless" };

  const block = formatPreferencesForPrompt(kit, { product: "Daikin Fit system" });
  assert(block.includes("Client-wide rule"));
  assert(block.includes("Lead with #1 distributor"));

  const notes = formatProductNotesForPrompt(kit, "Daikin Fit system");
  assert(notes.includes("Local stock"));
}

function testNoProductContextClientOnly() {
  const kit = createEmptyBrandKitData();
  kit.clientPreferences = [
    pref("client", "Client-wide rule"),
    pref("product:Daikin", "Product-specific"),
  ];

  const block = formatPreferencesForPrompt(kit, {});
  assert(block.includes("Client-wide rule"));
  assert(!block.includes("Product-specific"));
}

function main() {
  console.log("Preference scoping tests\n" + "=".repeat(40));
  testClientOnlyWhenProductAmbiguous();
  console.log("  [PASS] ambiguous product → client-only preferences");
  testConfidentProductMatch();
  console.log("  [PASS] confident product match includes scoped rules");
  testNoProductContextClientOnly();
  console.log("  [PASS] missing product → client-only");
  console.log("\n" + "=".repeat(40));
  console.log("All checks passed.\n");
}

main();
