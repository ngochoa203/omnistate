/**
 * Component Fingerprinting — structural identity for UI elements.
 *
 * A fingerprint captures the *structural* identity of a component:
 *   - role + position in the tree + sibling roles
 *
 * This is stable across visual changes (color, size, theme) but changes
 * when the component moves structurally (e.g. a button is removed/reordered).
 *
 * Usage:
 *   const fps = fingerprintTree(rootNode);        // walk & store
 *   const match = findComponent({ text: "Save" }); // query the store
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComponentFingerprint {
  /** Stable hash of the component's full identity (structure + text). */
  id: string;
  /** Original accessibility role (e.g. "AXButton", "AXTextField"). */
  role: string;
  /** Text content — first non-empty of title | value | description. */
  text: string | null;
  /** Path from root, e.g. "AXWindow[0]/AXToolbar[0]/AXButton[2]". */
  treePath: string;
  /** High-level semantic role inferred from role + text + attributes. */
  semanticRole: string;
  /**
   * Structural hash — computed from role + parent role + sibling index
   * + identifier attribute. Does NOT include text or bounds, so it stays
   * stable across label/color changes.
   */
  structuralHash: string;
  /** Bounds at the time of fingerprinting. */
  bounds: { x: number; y: number; width: number; height: number };
  /**
   * Confidence this is the same component as the previously stored one.
   * 1.0 = perfect structural + text match, lower when text or position drifts.
   */
  matchConfidence: number;
  /** Raw accessibility attributes for additional matching. */
  attributes: Record<string, string>;
  /** ISO timestamp of when this fingerprint was last observed. */
  lastSeen: string;
}

export interface FingerprintStore {
  /** Key = structuralHash (stable, survives visual redesigns). */
  fingerprints: Map<string, ComponentFingerprint>;
  /** Incremented each time fingerprintTree() is called. */
  treeVersion: number;
}

// ---------------------------------------------------------------------------
// Module-level store (singleton — one per Node.js module instance)
// ---------------------------------------------------------------------------

const store: FingerprintStore = {
  fingerprints: new Map(),
  treeVersion: 0,
};

// ---------------------------------------------------------------------------
// Core fingerprinting
// ---------------------------------------------------------------------------

/**
 * Generate a fingerprint for a single accessibility tree node.
 *
 * @param node          - Raw node from the accessibility tree.
 * @param parentPath    - treePath of the parent (empty string for root).
 * @param siblingIndex  - 0-based index among siblings of the SAME role.
 * @param parentRole    - role string of the parent node.
 */
export function fingerprintNode(
  node: Record<string, unknown>,
  parentPath: string = "",
  siblingIndex: number = 0,
  parentRole: string = "root"
): ComponentFingerprint {
  const role = String(node.role ?? "Unknown");
  const text =
    String(node.title ?? node.value ?? node.description ?? "").trim() || null;
  const treePath = parentPath
    ? `${parentPath}/${role}[${siblingIndex}]`
    : `${role}[${siblingIndex}]`;

  const attrs = (node.attributes as Record<string, string>) ?? {};

  // Structural hash: stable across text/color/size changes.
  // Includes role, parent role, sibling index, and stable platform identifier.
  const structuralInput = [
    role,
    parentRole,
    siblingIndex.toString(),
    attrs.identifier ?? "",
    attrs.subrole ?? "",
  ].join("|");
  const structuralHash = createHash("sha256")
    .update(structuralInput)
    .digest("hex")
    .slice(0, 12);

  // Full fingerprint id — incorporates text so two same-role buttons at the
  // same position but with different labels get distinct ids.
  const fullInput = `${structuralHash}:${text ?? ""}`;
  const id = createHash("sha256").update(fullInput).digest("hex").slice(0, 16);

  const rawBounds = node.bounds as
    | { x: number; y: number; width: number; height: number }
    | undefined;
  const bounds = rawBounds ?? { x: 0, y: 0, width: 0, height: 0 };

  return {
    id,
    role,
    text,
    treePath,
    semanticRole: inferSemanticRole(role, text, attrs),
    structuralHash,
    bounds,
    matchConfidence: 1.0,
    attributes: attrs,
    lastSeen: new Date().toISOString(),
  };
}

/**
 * Walk an accessibility tree, fingerprint every node, and update the store.
 *
 * Sibling indices are tracked *per-role* within each parent so that
 * "the third AXButton under AXToolbar[0]" always produces the same path
 * regardless of non-button siblings being added or removed.
 *
 * @param rootNode - Root node of the accessibility tree.
 * @returns Flat list of all fingerprints (including match confidence vs store).
 */
export function fingerprintTree(
  rootNode: Record<string, unknown>
): ComponentFingerprint[] {
  const newFingerprints: ComponentFingerprint[] = [];

  function walk(
    node: Record<string, unknown>,
    parentPath: string,
    siblingIndex: number,
    parentRole: string
  ): void {
    const fp = fingerprintNode(node, parentPath, siblingIndex, parentRole);

    // Compare against previously stored fingerprint for this structural slot.
    const existing = store.fingerprints.get(fp.structuralHash);
    if (existing) {
      // Same structural position — check for drift.
      if (existing.text !== fp.text) {
        fp.matchConfidence = 0.8; // Text changed (e.g. counter label updated).
      }
      const dx = Math.abs(existing.bounds.x - fp.bounds.x);
      const dy = Math.abs(existing.bounds.y - fp.bounds.y);
      if (dx > 50 || dy > 50) {
        // Bounds moved noticeably (layout reflow, window resize).
        fp.matchConfidence = Math.min(fp.matchConfidence, 0.6);
      }
    }

    store.fingerprints.set(fp.structuralHash, fp);
    newFingerprints.push(fp);

    const children = node.children as Array<Record<string, unknown>> | undefined;
    if (children && children.length > 0) {
      // Track sibling index per-role so structural paths are role-homogeneous.
      const roleCounts: Record<string, number> = {};
      for (const child of children) {
        const childRole = String(child.role ?? "Unknown");
        const idx = roleCounts[childRole] ?? 0;
        roleCounts[childRole] = idx + 1;
        walk(child, fp.treePath, idx, fp.role);
      }
    }
  }

  walk(rootNode, "", 0, "root");
  store.treeVersion++;

  return newFingerprints;
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

/**
 * Find the best-matching component in the store.
 *
 * Scoring (cumulative, higher = better match):
 *   +100  exact structuralHash match
 *   +80   exact treePath match
 *   +60   exact text match
 *   +40   text contains query
 *   +30   query contains text
 *   +25   semanticRole match
 *   +20   role match
 *   +0-30 proximity bonus (linear decay over nearBounds.radius)
 */
export function findComponent(query: {
  text?: string;
  role?: string;
  semanticRole?: string;
  structuralHash?: string;
  treePath?: string;
  nearBounds?: { x: number; y: number; radius: number };
}): ComponentFingerprint | null {
  let bestMatch: ComponentFingerprint | null = null;
  let bestScore = 0;

  for (const fp of store.fingerprints.values()) {
    let score = 0;

    if (query.structuralHash && fp.structuralHash === query.structuralHash) {
      score += 100;
    }

    if (query.treePath && fp.treePath === query.treePath) {
      score += 80;
    }

    if (query.text && fp.text) {
      if (fp.text === query.text) {
        score += 60;
      } else if (fp.text.toLowerCase().includes(query.text.toLowerCase())) {
        score += 40;
      } else if (query.text.toLowerCase().includes(fp.text.toLowerCase())) {
        score += 30;
      }
    }

    if (query.semanticRole && fp.semanticRole === query.semanticRole) {
      score += 25;
    }

    if (query.role && fp.role === query.role) {
      score += 20;
    }

    if (query.nearBounds) {
      const cx = fp.bounds.x + fp.bounds.width / 2;
      const cy = fp.bounds.y + fp.bounds.height / 2;
      const dx = cx - query.nearBounds.x;
      const dy = cy - query.nearBounds.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < query.nearBounds.radius) {
        score += Math.max(0, 30 * (1 - dist / query.nearBounds.radius));
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { ...fp }; // shallow copy so we can mutate matchConfidence
    }
  }

  if (bestMatch) {
    bestMatch.matchConfidence = Math.min(1, bestScore / 100);
  }

  return bestMatch;
}

/** Return all stored fingerprints (useful for debugging / UI display). */
export function getAllFingerprints(): ComponentFingerprint[] {
  return Array.from(store.fingerprints.values());
}

/** Clear the fingerprint store (e.g. when the target app changes). */
export function clearFingerprints(): void {
  store.fingerprints.clear();
  store.treeVersion = 0;
}

/** Current tree version counter (incremented by each fingerprintTree call). */
export function getTreeVersion(): number {
  return store.treeVersion;
}

// ---------------------------------------------------------------------------
// Semantic role inference
// ---------------------------------------------------------------------------

/**
 * Infer a high-level semantic role from low-level accessibility data.
 *
 * The returned strings are stable identifiers used for cross-session
 * component matching (e.g. "action-submit" survives button colour changes).
 */
function inferSemanticRole(
  role: string,
  text: string | null,
  attributes: Record<string, string>
): string {
  const r = role.toLowerCase();
  const t = (text ?? "").toLowerCase();
  const subrole = (attributes.subrole ?? "").toLowerCase();

  // Structural containers
  if (r.includes("window")) return "layout-window";
  if (r.includes("scrollarea") || r.includes("scrollbar")) return "layout-scroll";
  if (r.includes("splitter") || r.includes("splitgroup")) return "layout-split";
  if (r.includes("group") || r.includes("box")) return "layout-group";

  // Navigation bars
  if (r.includes("toolbar") || r.includes("tabbar")) return "navigation";
  if (r.includes("menubar") || r.includes("menu")) return "navigation-menu";
  if (r.includes("tab")) return "navigation-tab";

  // Headings
  if (r.includes("heading") || subrole.includes("heading")) return "heading";

  // Buttons — classify by text intent
  if (r === "axbutton" || r === "button" || r.includes("button")) {
    if (t.includes("search") || t.includes("filter")) return "action-search";
    if (t.includes("close") || t.includes("cancel") || t.includes("dismiss"))
      return "action-close";
    if (
      t.includes("submit") ||
      t.includes("save") ||
      t.includes("ok") ||
      t.includes("confirm")
    )
      return "action-submit";
    if (t.includes("back") || t.includes("previous") || t.includes("prev"))
      return "action-back";
    if (t.includes("next") || t.includes("forward")) return "action-next";
    if (t.includes("add") || t.includes("new") || t.includes("create"))
      return "action-create";
    if (t.includes("delete") || t.includes("remove")) return "action-delete";
    return "action-button";
  }

  // Inputs
  if (r.includes("searchfield")) return "input-search";
  if (r.includes("textfield") || r.includes("textarea")) return "input-text";
  if (r.includes("checkbox")) return "input-checkbox";
  if (r.includes("radiobutton")) return "input-radio";
  if (r.includes("popupbutton") || r.includes("combobox")) return "input-select";
  if (r.includes("slider")) return "input-slider";
  if (r.includes("stepper")) return "input-stepper";

  // Content
  if (r.includes("link") || r.includes("url")) return "content-link";
  if (r.includes("image") || r.includes("icon")) return "content-image";
  if (r.includes("table") || r.includes("grid")) return "content-table";
  if (r.includes("list")) return "content-list";
  if (r.includes("statictext") || r.includes("label")) return "content-text";

  return "unknown";
}
