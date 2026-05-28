#!/usr/bin/env node
// 批量给 sites.js 里所有条目跑一遍 AI vision，把 11 层 spec 写到 sites-specs.json
// 用法:
//   node scripts/backfill-specs.mjs           # 跳过已处理的
//   node scripts/backfill-specs.mjs --force   # 全部重跑
//   node scripts/backfill-specs.mjs --only linear,stripe   # 只跑指定 id
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SUPABASE_URL = "https://nlsvjigoltvyfpqsbygh.supabase.co";
const ANON_KEY = "sb_publishable_e3rcpZdJG8e15iOrWOJQTA_dy3Zbgul";
const FN_URL = `${SUPABASE_URL}/functions/v1/analyze-site`;

// CLI flags
const FORCE = process.argv.includes("--force");
const onlyArg = process.argv.find(a => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(",")) : null;

// 装载 sites.js（vm sandbox 安全）
const sitesCode = readFileSync(join(ROOT, "sites.js"), "utf8");
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(sitesCode, ctx);
const sites = ctx.window.STYLE_ATLAS_SITES;

if (!Array.isArray(sites) || sites.length === 0) {
  console.error("✕ sites.js 没装载到有效 STYLE_ATLAS_SITES 数组");
  process.exit(1);
}

console.log(`▸ 装载 ${sites.length} 个 site\n`);

// 装载现有 specs
const SPECS_FILE = join(ROOT, "sites-specs.json");
let specs = {};
if (existsSync(SPECS_FILE)) {
  try { specs = JSON.parse(readFileSync(SPECS_FILE, "utf8")); } catch {}
}

let ok = 0, skipped = 0, failed = 0;
const startTime = Date.now();

for (const site of sites) {
  if (ONLY && !ONLY.has(site.id)) continue;
  if (specs[site.id]?.spec && !FORCE) {
    console.log(`  · ${site.id.padEnd(22)} ⏭  跳过（已有 spec）`);
    skipped++;
    continue;
  }
  if (!site.image || !site.image.startsWith("http")) {
    console.log(`  · ${site.id.padEnd(22)} ✕ 缺 image`);
    failed++;
    continue;
  }

  process.stdout.write(`  ▸ ${site.id.padEnd(22)} 分析中...`);
  const t0 = Date.now();
  try {
    const res = await fetch(FN_URL, {
      method: "POST",
      headers: {
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: site.url,
        screenshotUrl: site.image,
        palette: [],
        meta: {
          title: site.title,
          description: site.notes || ""
        }
      })
    });
    const t = ((Date.now() - t0) / 1000).toFixed(1);
    if (!res.ok) {
      const text = await res.text();
      console.log(` ✕ HTTP ${res.status} (${t}s) ${text.slice(0,80)}`);
      failed++;
      continue;
    }
    const data = await res.json();
    if (data.error) {
      console.log(` ✕ ${data.error} (${t}s)`);
      failed++;
      continue;
    }
    if (!data.spec) {
      console.log(` ✕ no spec in response (${t}s)`);
      failed++;
      continue;
    }
    specs[site.id] = {
      spec: data.spec,
      _generatedAt: new Date().toISOString(),
      _model: data.model || "unknown",
      _source: "edge-function:analyze-site"
    };
    // 增量保存（防止中途崩了丢失进度）
    writeFileSync(SPECS_FILE, JSON.stringify(specs, null, 2) + "\n", "utf8");
    console.log(` ✓ (${t}s)`);
    ok++;
  } catch (err) {
    console.log(` ✕ ${err.message}`);
    failed++;
  }
  // 速率限制：别打爆 mimo
  await new Promise(r => setTimeout(r, 1200));
}

const total = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✓ ${ok} 个成功 · ${skipped} 个跳过 · ${failed} 个失败 · 总耗时 ${total}s`);
console.log(`  写入: ${SPECS_FILE}`);
console.log(`  覆盖 ${Object.keys(specs).length} / ${sites.length} 个 site`);
