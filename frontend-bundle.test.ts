// The bb server builds the frontend bundle without the SDK root on the resolve
// path (only "@get-bb/plugin-sdk/app" is provided), so nothing reachable from
// app.tsx may import "@get-bb/plugin-sdk" at runtime.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));
const EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const FORBIDDEN = "@get-bb/plugin-sdk";

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? resolve(root, spec.slice(2)) : resolve(dirname(from), spec);
  // TypeScript-style "./x.js" specifiers point at x.ts or x.tsx.
  const stem = base.replace(/\.js$/, "");
  const candidates = stem === base ? EXTS.map((e) => base + e) : [stem + ".ts", stem + ".tsx"];
  for (const file of candidates) {
    if (/\.(ts|tsx)$/.test(file) && existsSync(file)) return file;
  }
  return null;
}

// Runtime imports only: `import type ...` and all-inline-`type` imports are erased.
function runtimeSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of source.matchAll(re)) {
    if (m[4] !== undefined) {
      if (m[2]) continue;
      const clause = m[3].trim();
      const named = clause.match(/^\{([\s\S]*)\}$/);
      if (named) {
        const items = named[1].split(",").map((s) => s.trim()).filter(Boolean);
        if (items.length > 0 && items.every((i) => i.startsWith("type "))) continue;
      }
      specs.push(m[4]);
    } else specs.push((m[5] ?? m[6]) as string);
  }
  return specs;
}

function reachable(entry: string): { files: string[]; offenders: string[]; unresolved: string[] } {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeSpecifiers(readFileSync(file, "utf8"))) {
      if (spec === FORBIDDEN) offenders.push(`${file.slice(root.length + 1)} imports ${spec}`);
      const next = spec.startsWith(".") || spec.startsWith("@/") ? resolveLocal(file, spec) : null;
      if (next) queue.push(next);
      else if ((spec.startsWith(".") || spec.startsWith("@/")) && !spec.endsWith(".css")) {
        unresolved.push(`${file.slice(root.length + 1)} imports ${spec}`);
      }
    }
  }
  return { files: [...seen], offenders, unresolved };
}

describe("frontend bundle", () => {
  it("reaches the voice component from app.tsx", () => {
    const { files } = reachable(resolve(root, "app.tsx"));
    expect(files.some((f) => f.endsWith("components/voice.tsx"))).toBe(true);
  });

  it("never imports the SDK root at runtime from files reachable from app.tsx", () => {
    expect(reachable(resolve(root, "app.tsx")).offenders).toEqual([]);
  });

  it("follows .js specifiers into TypeScript files and resolves every local import", () => {
    const { files, unresolved } = reachable(resolve(root, "app.tsx"));
    expect(files.some((f) => f.endsWith("components/ui/motion.ts"))).toBe(true);
    expect(unresolved).toEqual([]);
  });

  it("detects a runtime SDK import but ignores type-only ones", () => {
    expect(runtimeSpecifiers('import { defineRpcContract } from "@get-bb/plugin-sdk";')).toContain(FORBIDDEN);
    expect(runtimeSpecifiers('import type { A } from "@get-bb/plugin-sdk";')).toEqual([]);
    expect(runtimeSpecifiers('import { type A } from "@get-bb/plugin-sdk";')).toEqual([]);
  });
});
