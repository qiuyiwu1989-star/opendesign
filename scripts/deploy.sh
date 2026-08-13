#!/usr/bin/env bash
# 增量部署：把 OpenDesign 静态站推到生产
# 用法: ./scripts/deploy.sh
#       SKIP_BUILD=1 ./scripts/deploy.sh    # 不重跑 build.py
#       SKIP_SEO=1 ./scripts/deploy.sh      # 跳过 SEO 静态页（debug 用）
set -euo pipefail

# 部署目标从 scripts/deploy-target.env 统一读取（改机器只改那一个文件）
# shellcheck source=./deploy-target.env
source "$(dirname "${BASH_SOURCE[0]}")/deploy-target.env"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o PreferredAuthentications=publickey,keyboard-interactive,password)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="/tmp/opendesign-deploy-$$.tar.gz"   # $$ = PID，并发多站同时部署安全

# Step 1: build dist/（可跳过加速调试）
if [[ -z "${SKIP_BUILD:-}" ]]; then
  echo "▸ Building dist/"
  python3 "${ROOT_DIR}/scripts/build.py"
fi

# Step 2 前置闸门：dist/ 必须跟 sites/ 对得上，才允许覆盖根目录产物。
#
# 2026-08-08 的事故：SKIP_BUILD=1 部署时，dist/ 里留着一次 --slug 局部构建的
# 残留（只有 527 条），Step 2 照样把它拷进根目录、Step 3 照样推上线——
# 全程零报错，线上 1,486 个站直接变成 527 个，是隔了很久才靠数条目数发现的。
#
# 所以这里改成硬闸门：dist 条目数少于 sites/ 里可发布数的 95% 就中止。
# 宁可拦一次正常部署，也不要再静默发布一个残缺的库。
echo "▸ Gate: dist/ 完整性"
python3 - "$ROOT_DIR" <<'GATE' || { echo "✗ 完整性闸门未通过 —— 已中止部署（重跑一次不带 SKIP_BUILD 的完整构建）"; exit 1; }
import json, glob, os, sys
root = sys.argv[1]
# sites/ 里"能出现在前端"的口径：非 broken / archived / failed*
publishable = 0
for f in glob.glob(os.path.join(root, "sites", "*.json")):
    try:
        st = (json.load(open(f, encoding="utf-8")).get("status") or "")
    except Exception:
        continue
    if not st.startswith(("broken", "archived", "failed")):
        publishable += 1

idx_path = os.path.join(root, "dist", "sites-index.json")
if not os.path.exists(idx_path):
    print(f"  ✗ 缺 {idx_path} —— dist/ 没构建过"); sys.exit(1)
d = json.load(open(idx_path, encoding="utf-8"))
rows = d if isinstance(d, list) else (d.get("sites") or list(d.values()))

floor = int(publishable * 0.95)
if len(rows) < floor:
    print(f"  ✗ dist/sites-index.json 只有 {len(rows)} 条，sites/ 里可发布 {publishable} 条"
          f"（下限 {floor}）——dist/ 是陈旧或局部构建的残留")
    sys.exit(1)
print(f"  ✓ dist/sites-index.json {len(rows)} 条 vs sites/ 可发布 {publishable} 条")
GATE

# Step 2: build.py 出的产物同步回根目录（前端从根目录读）
echo "▸ Sync built files → root"
cp "${ROOT_DIR}/dist/legacy/sites.js"          "${ROOT_DIR}/sites.js"
cp "${ROOT_DIR}/dist/legacy/sites-specs.json"  "${ROOT_DIR}/sites-specs.json"
cp "${ROOT_DIR}/dist/legacy/sites-i18n.json"   "${ROOT_DIR}/sites-i18n.json"
for _lang in en zh-CN zh-TW ja ko; do
  cp "${ROOT_DIR}/dist/legacy/sites-i18n.${_lang}.json" "${ROOT_DIR}/sites-i18n.${_lang}.json"
done
cp "${ROOT_DIR}/dist/sitemap.xml"              "${ROOT_DIR}/sitemap.xml"
cp "${ROOT_DIR}/dist/sites-index.json"         "${ROOT_DIR}/sites-index.json"   # 精简首页索引（含单张 pack preview）

# 首页性能闸门：卡片只消费折叠后的 preview URL，不能再依赖约 4MB 的完整清单。
python3 - "$ROOT_DIR/sites-index.json" <<'PERF_GATE' || { echo "✗ 首页预览性能闸门未通过"; exit 1; }
import json, os, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
rows = d.get("sites", []) if isinstance(d, dict) else d
size = os.path.getsize(p)
previews = sum(bool(r.get("pack_preview")) for r in rows)
if size > 900_000:
    print(f"  ✗ sites-index.json {size} bytes（预算 900000）"); sys.exit(1)
if previews < 450:
    print(f"  ✗ 只有 {previews} 条 COS pack_preview（至少 450）"); sys.exit(1)
print(f"  ✓ 首页索引 {size} bytes · {previews} 条可靠 pack preview")
PERF_GATE

# 网站运行所需的前端资源
FILES=(
  index.html
  admin.html
  admin.js
  styles.css
  app.js
  i18n.js
  sites-index.json
  sites.js
  sites-specs.json
  sites-i18n.json
  sites-i18n.en.json
  sites-i18n.zh-CN.json
  sites-i18n.zh-TW.json
  sites-i18n.ja.json
  sites-i18n.ko.json
  supabase-config.js
  favicon.svg
  og-cover.png
  sitemap.xml
  robots.txt
  llms.txt
  packs-index.json
  manifest.json
  sw.js
  catalog.json
  skill.md
)

echo "▸ Packing files"
MANIFEST=()
for f in "${FILES[@]}"; do
  if [[ ! -f "${ROOT_DIR}/${f}" ]]; then
    echo "  ✕ missing: ${f}" >&2
    exit 1
  fi
  echo "  • ${f}"
  MANIFEST+=("${f}")
done

# 把 dist/seo/ 内容也加进去（5000 个静态 HTML 给 SEO 用）
if [[ -z "${SKIP_SEO:-}" && -d "${ROOT_DIR}/dist/seo" ]]; then
  echo "  • dist/seo (multilang static pages)"
  MANIFEST+=("dist/seo")
fi

# 把 dist/packs/ 内容加进去（每站 DESIGN.md + DESIGN_SPEC.<lang>.md，给 Agent URL 用）
if [[ -d "${ROOT_DIR}/dist/packs" ]]; then
  echo "  • dist/packs (per-site DESIGN.md + DESIGN_SPEC.<lang>.md)"
  MANIFEST+=("dist/packs")
fi

# PWA 图标目录
if [[ -d "${ROOT_DIR}/icons" ]]; then
  echo "  • icons (PWA app icons)"
  MANIFEST+=("icons")
fi

# MCP 安装页 + 服务器文件（/mcp/ 给 agent 接入用）
if [[ -d "${ROOT_DIR}/mcp" ]]; then
  echo "  • mcp (install page + MCP server)"
  MANIFEST+=("mcp")
fi

# ===== LOCAL_DEPLOY：脚本就跑在 web 服务器上（job runner 用）→ 直接 cp 到 DEPLOY_PATH，不 scp =====
if [[ -n "${LOCAL_DEPLOY:-}" ]]; then
  echo "▸ LOCAL_DEPLOY：本机 cp → ${DEPLOY_PATH}"
  sudo mkdir -p "${DEPLOY_PATH}"
  for f in "${MANIFEST[@]}"; do
    if [[ "$f" == "dist/seo" ]]; then
      for lang in en zh-CN zh-TW ja ko; do
        [[ -d "${ROOT_DIR}/dist/seo/${lang}" ]] && sudo mkdir -p "${DEPLOY_PATH}/${lang}" && sudo cp -r "${ROOT_DIR}/dist/seo/${lang}/"* "${DEPLOY_PATH}/${lang}/"
      done
    elif [[ "$f" == "dist/packs" ]]; then
      sudo mkdir -p "${DEPLOY_PATH}/packs" && sudo cp -r "${ROOT_DIR}/dist/packs/"* "${DEPLOY_PATH}/packs/"
    elif [[ "$f" == "icons" ]]; then
      sudo mkdir -p "${DEPLOY_PATH}/icons" && sudo cp -r "${ROOT_DIR}/icons/"* "${DEPLOY_PATH}/icons/"
    elif [[ "$f" == "mcp" ]]; then
      sudo mkdir -p "${DEPLOY_PATH}/mcp" && sudo cp -r "${ROOT_DIR}/mcp/"* "${DEPLOY_PATH}/mcp/"
    else
      sudo cp "${ROOT_DIR}/${f}" "${DEPLOY_PATH}/${f}"
    fi
  done
  if [[ -f "${ROOT_DIR}/scripts/gen-thumbs.py" ]]; then
    # --out 用【持久】缓存目录而不是每次都空的 /tmp：空目录会让"已存在就跳过"
    # 完全失效，于是每次部署都把 1490 个 slug 全试一遍、刷出近千行 ✗。
    # --from-cos：素材只在 COS 上的包也能回源生成缩略图。
    THUMB_CACHE="${HOME}/.cache/opendesign-thumbs"
    mkdir -p "$THUMB_CACHE"
    python3 "${ROOT_DIR}/scripts/gen-thumbs.py" --packs "${DEPLOY_PATH}/packs" \
      --out "$THUMB_CACHE" --from-cos "${ROOT_DIR}/packs-index.json" 2>&1 | tail -3 || true
    sudo mkdir -p "${DEPLOY_PATH}/thumbs" && sudo cp -n "$THUMB_CACHE"/*.webp "${DEPLOY_PATH}/thumbs/" 2>/dev/null || true
  fi
  sudo chown -R www-data:www-data "${DEPLOY_PATH}"
  echo "✓ LOCAL_DEPLOY done"
  exit 0
fi

tar --no-xattrs --disable-copyfile -czf "${ARCHIVE}" -C "${ROOT_DIR}" "${MANIFEST[@]}"

echo "▸ Uploading to ${DEPLOY_USER}@${DEPLOY_HOST}"
REMOTE_ARCHIVE="/tmp/opendesign-deploy-$$.tar.gz"   # 带 PID：并发部署不互相覆盖
scp "${SSH_OPTS[@]}" "${ARCHIVE}" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_ARCHIVE}"

echo "▸ Extracting on server"
ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "
  sudo mkdir -p '${DEPLOY_PATH}' &&
  sudo tar -xzf ${REMOTE_ARCHIVE} -C '${DEPLOY_PATH}' &&
  if [[ -d '${DEPLOY_PATH}/dist/seo' ]]; then
    # 把 dist/seo/<lang>/ 内容铺到 <DEPLOY_PATH>/<lang>/ 让 nginx 直接 serve
    for lang in en zh-CN zh-TW ja ko; do
      if [[ -d '${DEPLOY_PATH}/dist/seo/'\$lang ]]; then
        sudo mkdir -p '${DEPLOY_PATH}/'\$lang &&
        sudo cp -r '${DEPLOY_PATH}/dist/seo/'\$lang'/'* '${DEPLOY_PATH}/'\$lang'/'
      fi
    done
  fi &&
  if [[ -d '${DEPLOY_PATH}/dist/packs' ]]; then
    # 把每站 DESIGN.md / DESIGN_SPEC.<lang>.md 铺到 <DEPLOY_PATH>/packs/<slug>/
    # 用 cp -r（不删目标），所以已有的完整 Playwright pack（截图 / ZIP）不被覆盖
    sudo mkdir -p '${DEPLOY_PATH}/packs' &&
    sudo cp -r '${DEPLOY_PATH}/dist/packs/'* '${DEPLOY_PATH}/packs/'
  fi &&
  if [[ -f /home/ubuntu/opendesign/scripts/gen-thumbs.py ]]; then
    # 从每个完整包 ZIP 抽真桌面首屏截图缩成 webp → /thumbs/<slug>.webp（卡片图源，甩开 thum.io 截垃圾页）
    # 以 ubuntu 跑（有 Pillow）读公开 ZIP、写 /tmp，再 sudo cp 进 /thumbs（幂等，缺啥补啥）
    # --out 是持久缓存（不是每次都空的 /tmp），否则"已存在就跳过"失效、每次刷近千行 ✗
    mkdir -p /home/ubuntu/.cache/opendesign-thumbs;
    python3 /home/ubuntu/opendesign/scripts/gen-thumbs.py --packs '${DEPLOY_PATH}/packs' --out /home/ubuntu/.cache/opendesign-thumbs --from-cos /home/ubuntu/opendesign/packs-index.json 2>&1 | tail -3 || true;
    sudo mkdir -p '${DEPLOY_PATH}/thumbs';
    sudo cp -n /home/ubuntu/.cache/opendesign-thumbs/*.webp '${DEPLOY_PATH}/thumbs/' 2>/dev/null || true;
  fi &&
  sudo chown -R www-data:www-data '${DEPLOY_PATH}' &&
  sudo find '${DEPLOY_PATH}' -name '._*' -delete &&
  rm ${REMOTE_ARCHIVE}
"

rm "${ARCHIVE}"

echo ""
echo "✓ Done. Visit:"
echo "   SPA:    ${DEPLOY_URL}"
echo "   SEO en: ${DEPLOY_URL}/en/sites/apple"
echo "   SEO ja: ${DEPLOY_URL}/ja/sites/apple"
