import { describe, it, expect } from "vitest";

import {
  addEntry,
  getEntry,
  listAll,
  deleteEntry,
  searchByKey,
  toPublicEntry,
  maskValue,
} from "../session/memory-pal.js";

describe("maskValue", () => {
  it("returns bullet chars matching value length (capped at 8)", () => {
    expect(maskValue("hi")).toBe("••");
    expect(maskValue("hello")).toBe("•••••");
    expect(maskValue("supersecret123")).toBe("••••••••");
  });
});

describe("toPublicEntry masking", () => {
  it("masks value for sensitive entries", () => {
    const entry = { id: "x", category: "password" as const, key: "k", value: "realpass", sensitive: true, createdAt: "", updatedAt: "" };
    const pub = toPublicEntry(entry);
    expect(pub.value).not.toBe("realpass");
    expect(pub.value).toMatch(/^•+$/);
  });

  it("returns plain value for non-sensitive entries", () => {
    const entry = { id: "x", category: "note" as const, key: "k", value: "visible", sensitive: false, createdAt: "", updatedAt: "" };
    const pub = toPublicEntry(entry);
    expect(pub.value).toBe("visible");
  });
});

describe("MemoryPal integration (file-backed)", () => {
  // These tests exercise the real file I/O using the default path (~/.omnistate/memory-pal.json).
  // They add entries and clean up via delete.

  it("adds and retrieves an entry", () => {
    const entry = addEntry({ category: "note", key: `test-${Date.now()}`, value: "world", sensitive: false });
    expect(entry.id).toBeTruthy();
    const fetched = getEntry(entry.id);
    expect(fetched?.value).toBe("world");
    deleteEntry(entry.id);
  });

  it("lists entries with category filter", () => {
    const entry = addEntry({ category: "contact", key: `alice-${Date.now()}`, value: "0901234567", sensitive: false });
    const contacts = listAll("contact");
    expect(contacts.some((e) => e.id === entry.id)).toBe(true);
    deleteEntry(entry.id);
  });

  it("deletes an entry", () => {
    const entry = addEntry({ category: "preference", key: `theme-${Date.now()}`, value: "dark", sensitive: false });
    expect(deleteEntry(entry.id)).toBe(true);
    expect(getEntry(entry.id)).toBeNull();
    expect(deleteEntry(entry.id)).toBe(false);
  });

  it("stores sensitive value plainly but toPublicEntry masks it", () => {
    const entry = addEntry({ category: "password", key: `wifi-${Date.now()}`, value: "supersecret123", sensitive: true });
    const fetched = getEntry(entry.id);
    expect(fetched?.value).toBe("supersecret123"); // full value via getEntry
    const pub = toPublicEntry(fetched!);
    expect(pub.value).not.toBe("supersecret123");
    deleteEntry(entry.id);
  });

  it("searches entries by key substring", () => {
    const entry = addEntry({ category: "note", key: `wifi-password-home-${Date.now()}`, value: "hunter2", sensitive: true });
    const results = searchByKey("wifi-password");
    expect(results.some((e) => e.id === entry.id)).toBe(true);
    deleteEntry(entry.id);
  });
});
