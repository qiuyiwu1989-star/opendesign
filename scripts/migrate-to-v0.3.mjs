#!/usr/bin/env node
/**
 * One-shot migration: merge sites.js + sites-specs.json + sites-i18n.json
 * → sites/<slug>.json (v0.3 schema).
 *
 * Idempotent: re-running overwrites with fresh merge. Old sites.js stays
 * (will be auto-generated from sites/*.json once build.py is wired up;
 * for now it's still the runtime source).
 *
 * Usage:
 *   node scripts/migrate-to-v0.3.mjs                    # all sites
 *   node scripts/migrate-to-v0.3.mjs --slug apple       # one site
 *   node scripts/migrate-to-v0.3.mjs --dry-run          # preview only
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import vm from "node:vm";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const SITES_OUT = path.join(ROOT, "sites");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const slugFilter = (() => {
  const i = args.indexOf("--slug");
  return i >= 0 ? args[i + 1] : null;
})();

const SCHEMA_VERSION = "0.3";

// 1) Load sites.js (JS literal, needs vm sandbox)
const sitesJsSrc = fs.readFileSync(path.join(ROOT, "sites.js"), "utf-8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(sitesJsSrc, sandbox);
const sites = sandbox.window.STYLE_ATLAS_SITES || [];
console.log(`[migrate] loaded ${sites.length} sites from sites.js`);

// 2) Load overlays
const specsExt = JSON.parse(fs.readFileSync(path.join(ROOT, "sites-specs.json"), "utf-8"));
const i18nOverlay = JSON.parse(fs.readFileSync(path.join(ROOT, "sites-i18n.json"), "utf-8"));
const packsIndex = JSON.parse(fs.readFileSync(path.join(ROOT, "packs-index.json"), "utf-8"));
console.log(`[migrate] specs overlay: ${Object.keys(specsExt).length} entries`);
console.log(`[migrate] i18n overlay:  ${Object.keys(i18nOverlay).filter(k => !k.startsWith("_")).length} entries`);
console.log(`[migrate] packs index:   ${Object.keys(packsIndex).filter(k => !k.startsWith("_")).length} packs ready`);

// 3) Extract en desc from the existing sites.js Chinese strings (best-effort)
//    The i18nOverlay holds the 5-lang desc; sites.js itself has the original
//    canonical Chinese (for the 12 first batch) or English (for the 8 legacy).
//    Use overlay if present, else fall back to site.<field>.
function buildDescBlock(site) {
  const overlay = i18nOverlay[site.id] || {};
  const langs = ["en", "zh-CN", "zh-TW", "ja", "ko"];
  const out = {};
  for (const lang of langs) {
    const block = overlay[lang];
    if (block && block.palette) {
      out[lang] = {
        palette: block.palette,
        layout: block.layout,
        interaction: block.interaction,
        motion: block.motion,
        notes: block.notes
      };
    }
  }
  // safety: if en somehow missing, copy from another lang
  if (!out.en && Object.values(out)[0]) {
    out.en = Object.values(out)[0];
    console.warn(`[migrate]   ! ${site.id}: en desc missing, copied from another lang`);
  }
  return out;
}

// 4) Extract spec_i18n from the existing site.spec object.
//    The spec we have today already mixes language-independent values
//    (hex/px) with language-relative description text. We separate them.
function splitSpec(spec) {
  if (!spec) return { langNeutral: {}, langRelative: {} };

  const langNeutral = {};
  const langRelative = {};

  // 1. identity — entirely language-relative
  if (spec.identity) langRelative.identity = { ...spec.identity };

  // 2. colors — bg/ink/accent hex stay; principle text moves to lang
  if (spec.colors) {
    const { principle, ...hexValues } = spec.colors;
    langNeutral.colors = hexValues;
    if (principle) langRelative.colors = { principle };
  }

  // 3. typography — display/body/mono categories + size numbers stay;
  //    rules + per-scale "use" text move to lang
  if (spec.typography) {
    const { rules, scale, ...rest } = spec.typography;
    const cleanScale = (scale || []).map(s => {
      const { use, ...rest } = s;
      return rest;
    });
    langNeutral.typography = { ...rest, scale: cleanScale };
    langRelative.typography = {
      rules: rules || [],
      scaleUses: (scale || []).map(s => s.use || "")
    };
  }

  // 4. spacing — numbers stay; rhythm text moves
  if (spec.spacing) {
    const { rhythm, ...rest } = spec.spacing;
    langNeutral.spacing = rest;
    if (rhythm) langRelative.spacing = { rhythm };
  }

  // 5. surfaces — radius numbers stay; shadows/borders text moves
  //    borders might be array in legacy specs; coerce to single sentence.
  if (spec.surfaces) {
    const { shadows, borders, ...rest } = spec.surfaces;
    langNeutral.surfaces = rest;
    const bordersStr = Array.isArray(borders)
      ? borders.filter(Boolean).join("；")
      : (borders || "");
    langRelative.surfaces = { shadows: shadows || [], borders: bordersStr };
  }

  // 6. layout — numbers stay; skeleton text moves
  if (spec.layout) {
    const { skeleton, ...rest } = spec.layout;
    langNeutral.layout = rest;
    if (skeleton) langRelative.layout = { skeleton };
  }

  // 7. components — entirely text recipes, lang-relative
  if (spec.components) langRelative.components = { ...spec.components };

  // 8. motion — durations/easing stay; patterns text moves
  if (spec.motion) {
    const { patterns, ...rest } = spec.motion;
    langNeutral.motion = rest;
    if (patterns) langRelative.motion = { patterns };
  }

  // 9. interaction — entirely text, lang-relative
  if (spec.interaction) langRelative.interaction = { ...spec.interaction };

  // 10. voice — entirely text, lang-relative
  if (spec.voice) langRelative.voice = { ...spec.voice };

  // 11. donts — text list, lang-relative
  if (spec.donts) langRelative.donts = spec.donts;

  // 12. systemPrompt — text, lang-relative
  if (spec.systemPrompt) langRelative.systemPrompt = spec.systemPrompt;

  return { langNeutral, langRelative };
}

// 5) Build the v0.3 single-site JSON
function buildSiteV3(site) {
  const slug = site.id;
  const desc = buildDescBlock(site);

  // Spec comes from sites-specs.json overlay (AI vision output) OR from
  // sites.js inline (curator-written). Prefer the inline if present.
  const inlineSpec = site.spec || null;
  const aiSpec = specsExt[slug] && specsExt[slug].spec ? specsExt[slug].spec : null;
  const sourceSpec = inlineSpec || aiSpec;

  const { langNeutral, langRelative } = splitSpec(sourceSpec);

  // spec_i18n holds the language-relative spec parts. Until translation
  // pipeline runs for ALL specs, we only have ONE language version of the
  // langRelative bits — the language they were authored in. Drop them as
  // en for now; ingest.py will fill the other 4 langs on next run.
  const spec_i18n = sourceSpec ? { en: langRelative } : undefined;

  // _meta — omit fields when value is unknown rather than writing null
  const meta = {};
  const visionModel = (specsExt[slug] && specsExt[slug]._model)
    || (inlineSpec ? "curator-handwritten" : null);
  if (visionModel) meta.vision_model = visionModel;
  if (sourceSpec) meta.vision_prompt_version = "0.2_legacy";
  if (specsExt[slug] && specsExt[slug]._generatedAt) {
    meta.vision_at = specsExt[slug]._generatedAt;
  }

  const out = {
    id: slug,
    schema_version: SCHEMA_VERSION,
    url: site.url,
    title: site.title,
    image: site.image,
    tags: site.tags || [],
    status: sourceSpec ? "vision_done" : "pending",
    added_at: "2026-05-28",
    added_by: "curator",
    _meta: meta
  };

  if (Object.keys(langNeutral).length > 0) out.spec = langNeutral;
  if (Object.keys(desc).length > 0) out.desc = desc;
  if (spec_i18n) out.spec_i18n = spec_i18n;

  // Pack info
  const pack = packsIndex[slug];
  if (pack && !slug.startsWith("_") && typeof pack === "object" && pack.zipFile) {
    out.pack = {
      available: true,
      zip_url: `/packs/${pack.zipFile}`,
      zip_size: pack.zipSize || 0,
      folder_url: pack.agentUrl || `/packs/${slug}/`,
      file_count: (pack.files || []).length
    };
  }

  return out;
}

// 6) Write all sites
if (!dryRun) fs.mkdirSync(SITES_OUT, { recursive: true });

const stats = { written: 0, skipped: 0, with_spec: 0, with_pack: 0, with_5lang_desc: 0 };
const issues = [];

for (const site of sites) {
  if (slugFilter && site.id !== slugFilter) continue;

  const out = buildSiteV3(site);

  if (out.spec) stats.with_spec += 1;
  if (out.pack) stats.with_pack += 1;
  if (out.desc && Object.keys(out.desc).length === 5) stats.with_5lang_desc += 1;

  if (!out.desc || !out.desc.en) {
    issues.push(`${site.id}: missing canonical en desc`);
  }

  const outPath = path.join(SITES_OUT, `${site.id}.json`);
  if (dryRun) {
    console.log(`[dry] would write ${outPath} (${JSON.stringify(out).length} bytes)`);
  } else {
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf-8");
    console.log(`[ok] ${site.id}.json (${(JSON.stringify(out).length / 1024).toFixed(1)} KB)`);
  }
  stats.written += 1;
}

console.log("");
console.log(`Done. Wrote ${stats.written} / ${sites.length}`);
console.log(`  with spec block:     ${stats.with_spec}`);
console.log(`  with pack metadata:  ${stats.with_pack}`);
console.log(`  with all-5 lang desc: ${stats.with_5lang_desc}`);
if (issues.length) {
  console.log(`\nIssues to fix:`);
  for (const i of issues) console.log(`  ⚠ ${i}`);
}
