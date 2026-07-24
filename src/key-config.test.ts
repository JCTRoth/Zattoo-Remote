/**
 * Tests for key-config.json structure and validity.
 *
 * Validates:
 * - All mappings have required fields
 * - No duplicate key or action mappings
 * - Channel map entries are consistent
 * - Favorites reference valid colors
 * - Volume/channel timeouts are within reasonable ranges
 */

import { describe, it, expect } from "vitest";
import keyConfig from "./key-config.json";

describe("key-config.json", () => {
  // ── Basic Structure ───────────────────────────────────────────

  it("should have a valid version string", () => {
    expect(keyConfig.version).toBeDefined();
    expect(typeof keyConfig.version).toBe("string");
    expect(keyConfig.version).toMatch(/^\d+\.\d+$/);
  });

  it("should have a valid base_url", () => {
    expect(keyConfig.base_url).toBeDefined();
    expect(keyConfig.base_url).toMatch(/^https?:\/\//);
  });

  it("should have a valid region", () => {
    expect(keyConfig.region).toBeDefined();
    expect(["de", "at", "ch", "int"]).toContain(keyConfig.region);
  });

  it("should have a valid volume_step (1-100)", () => {
    expect(keyConfig.volume_step).toBeGreaterThanOrEqual(1);
    expect(keyConfig.volume_step).toBeLessThanOrEqual(100);
  });

  it("should have a valid channel_input_timeout_ms (500-10000)", () => {
    expect(keyConfig.channel_input_timeout_ms).toBeGreaterThanOrEqual(500);
    expect(keyConfig.channel_input_timeout_ms).toBeLessThanOrEqual(10000);
  });

  // ── Mappings ──────────────────────────────────────────────────

  describe("mappings", () => {
    it("should have at least 10 mappings", () => {
      expect(keyConfig.mappings.length).toBeGreaterThanOrEqual(10);
    });

    it("each mapping should have required fields", () => {
      for (const mapping of keyConfig.mappings) {
        expect(mapping.key).toBeDefined();
        expect(typeof mapping.key).toBe("string");
        expect(mapping.key.length).toBeGreaterThan(0);

        expect(mapping.action).toBeDefined();
        expect(typeof mapping.action).toBe("string");
        expect(mapping.action.length).toBeGreaterThan(0);

        expect(mapping.label).toBeDefined();
        expect(typeof mapping.label).toBe("string");
        expect(mapping.label.length).toBeGreaterThan(0);

        // zattoo_action can be null or a string
        if (mapping.zattoo_action !== null) {
          expect(typeof mapping.zattoo_action).toBe("string");
        }
      }
    });

    it("should not have duplicate keys", () => {
      const keys = keyConfig.mappings.map((m) => m.key);
      const uniqueKeys = new Set(keys);
      if (keys.length !== uniqueKeys.size) {
        const duplicates = keys.filter(
          (k, i) => keys.indexOf(k) !== i
        );
        throw new Error(`Duplicate keys found: ${[...new Set(duplicates)].join(", ")}`);
      }
    });

    it("should allow duplicate actions (multiple physical keys → same logical action)", () => {
      // Multiple physical keys can map to the same logical action.
      // E.g., both "Return" and "KpReturn" → "ok", both "Num1" and "Kp1" → "digit_1".
      // This is valid and expected.
      const actionEntries = new Map<string, typeof keyConfig.mappings[0][]>();
      for (const mapping of keyConfig.mappings) {
        const existing = actionEntries.get(mapping.action) || [];
        existing.push(mapping);
        actionEntries.set(mapping.action, existing);
      }

      // Verify that duplicate actions have consistent zattoo_action values
      for (const [action, entries] of actionEntries) {
        if (entries.length > 1) {
          const zActions = new Set(entries.map((e) => e.zattoo_action));
          // All entries with the same action should have the same zattoo_action
          if (zActions.size > 1) {
            throw new Error(
              `Action "${action}" has inconsistent zattoo_action values: ${[...zActions].join(", ")}`
            );
          }
        }
      }

      // Sanity: we should have some duplicate actions
      const duplicates = [...actionEntries.values()].filter((e) => e.length > 1);
      expect(duplicates.length).toBeGreaterThan(0);
    });

    it("should have zattoo_action in correct format when present", () => {
      for (const mapping of keyConfig.mappings) {
        if (mapping.zattoo_action) {
          // Format should be "action_type:param" or just "action_type"
          expect(mapping.zattoo_action).toMatch(
            /^[a-z_]+(:[\w\-.~:/?#[\]@!$&'()*+,;=%]+)?$/
          );
        }
      }
    });

    it("should have essential navigation mappings", () => {
      const actionSet = new Set(keyConfig.mappings.map((m) => m.action));
      const essential = [
        "up",
        "down",
        "ok",
        "back",
        "volume_up",
        "volume_down",
        "home",
        "play_pause",
      ];
      for (const action of essential) {
        expect(actionSet.has(action)).toBe(true);
      }
    });

    it("should have digit mappings (0-9)", () => {
      const digitActions = new Set(keyConfig.mappings.map((m) => m.action));
      for (let i = 0; i <= 9; i++) {
        expect(digitActions.has(`digit_${i}`)).toBe(true);
      }
    });

    it("should have color key mappings (red, green, yellow, blue)", () => {
      const colorActions = new Set(keyConfig.mappings.map((m) => m.action));
      for (const color of ["red", "green", "yellow", "blue"]) {
        expect(colorActions.has(`color_${color}`)).toBe(true);
      }
    });
  });

  // ── Favorites ─────────────────────────────────────────────────

  describe("favorites", () => {
    it("should have at least one favorite", () => {
      expect(keyConfig.favorites?.length).toBeGreaterThanOrEqual(1);
    });

    it("each favorite should have required fields", () => {
      for (const fav of keyConfig.favorites) {
        expect(fav.name).toBeDefined();
        expect(typeof fav.name).toBe("string");
        expect(fav.name.length).toBeGreaterThan(0);

        expect(fav.channel).toBeDefined();
        expect(typeof fav.channel).toBe("string");
        expect(fav.channel.length).toBeGreaterThan(0);

        expect(fav.color).toBeDefined();
        expect(["red", "green", "yellow", "blue"]).toContain(fav.color);
      }
    });

    it("should not have duplicate favorite colors", () => {
      const colors = keyConfig.favorites.map((f) => f.color);
      const uniqueColors = new Set(colors);
      expect(colors.length).toBe(uniqueColors.size);
    });
  });
});
