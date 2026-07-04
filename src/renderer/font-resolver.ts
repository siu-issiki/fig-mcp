/**
 * Font resolution for PNG rendering.
 *
 * resvg only sees fonts installed on this machine, so text set in fonts the
 * design uses but the machine lacks falls back to a default face. This
 * module downloads missing families from Google Fonts on demand and caches
 * the files under ~/.cache/fig-mcp/fonts. Families Google doesn't host
 * (proprietary/foundry fonts) are remembered as unavailable for the process
 * lifetime; callers can bridge those with the render fontMap option.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { UsedFont } from "./render-types.js";

const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".cache", "fig-mcp", "fonts");
const FETCH_TIMEOUT_MS = 10_000;

/** Families known (this process) to be unavailable on Google Fonts */
const unavailableFamilies = new Set<string>();

function familySlug(family: string): string {
  return family.replace(/[^\w-]+/g, "_");
}

function listFontFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(ttf|otf)$/i.test(f))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    // A non-browser UA makes the Google Fonts CSS API serve TTF URLs,
    // which resvg can load (it cannot read woff2).
    headers: { "User-Agent": "fig-mcp-font-resolver" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function downloadFamily(family: string, familyDir: string): Promise<string[]> {
  const query = family.trim().replace(/\s+/g, "+");
  // Request regular/bold with italics; fall back to the family default set
  // for families that don't have those exact variants.
  let css: string | null = null;
  for (const url of [
    `https://fonts.googleapis.com/css2?family=${query}:ital,wght@0,400;0,700;1,400;1,700`,
    `https://fonts.googleapis.com/css2?family=${query}`,
  ]) {
    try {
      css = await fetchText(url);
      break;
    } catch {
      // try next form
    }
  }
  if (!css) throw new Error(`family not found: ${family}`);

  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+\.(?:ttf|otf))\)/g)].map((m) => m[1]))];
  if (urls.length === 0) throw new Error(`no ttf/otf urls for: ${family}`);

  fs.mkdirSync(familyDir, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const res = await fetch(urls[i], { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) continue;
    const ext = urls[i].toLowerCase().endsWith(".otf") ? "otf" : "ttf";
    const file = path.join(familyDir, `${familySlug(family)}-${i}.${ext}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    files.push(file);
  }
  if (files.length === 0) throw new Error(`downloads failed for: ${family}`);
  return files;
}

export interface ResolveFontsResult {
  /** Font files to hand to resvg */
  fontFiles: string[];
  /** Families that could not be fetched (likely non-Google fonts) */
  missing: string[];
}

/**
 * Ensure font files exist locally for the given fonts. Cached families are
 * always used; downloading missing families from Google Fonts is opt-in
 * (`download: true`) because the request exposes the design's font family
 * names to a third party. Never throws: families that cannot be resolved
 * are reported in `missing`.
 */
export async function resolveFonts(
  fonts: UsedFont[],
  options: { cacheDir?: string; download?: boolean } = {},
): Promise<ResolveFontsResult> {
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const download = options.download === true;
  const fontFiles: string[] = [];
  const missing: string[] = [];

  const families = [...new Set(fonts.map((f) => f.family))];
  for (const family of families) {
    const familyDir = path.join(cacheDir, familySlug(family));
    const cached = listFontFiles(familyDir);
    if (cached.length > 0) {
      fontFiles.push(...cached);
      continue;
    }
    if (!download || unavailableFamilies.has(family)) {
      missing.push(family);
      continue;
    }
    try {
      fontFiles.push(...(await downloadFamily(family, familyDir)));
    } catch {
      unavailableFamilies.add(family);
      missing.push(family);
    }
  }

  return { fontFiles, missing };
}
