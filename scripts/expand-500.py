#!/usr/bin/env python3
"""扩展到 500 站 · 第三批 curated 候选 + 建 stub（dedup vs 现有）。

承接 expand-200.py。把网站数量目标提升到 500，所以「全网再筛一遍好设计」：
这里是高置信度的设计圈公认名站（设计工作室 / 字体厂 / 设计感 SaaS / 时尚奢侈 /
DTC 品牌 / 编辑媒体 / 美术馆文化 / 建筑家具 / 创作者作品集 / 硬件工业设计 …）。

注意：
- 运行时按 slug + host 去重（自动跳过库里已有的）。
- 渲染质量门（upgrade-pack.sh）+ 单站 schema 校验是安全网：抓不出来 / 反爬 / 离线
  的会被自动跳过，绝不发废包。所以这份清单宁可多列，最终净化后入库的会少于候选数。
- 不含之前因渲染失败被剔除的 8 个（active-theory / cohere / colophon / diagram /
  height / mastercard / perplexity / tesla）—— 它们走单独的重抓流程，不在这里凑数。

跑法：
  python3 scripts/expand-500.py --dry-run     # 只看分类 / 去重，不建文件
  python3 scripts/expand-500.py               # 建 sites/<slug>.json stub
建完 stub 后：export ANTHROPIC_*; bash scripts/upgrade-batch.sh   （可断点续跑）
"""
import json
import sys
import glob
import urllib.parse
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent.parent
SITES = ROOT / "sites"

# (slug, url, title, tags, category)
C = [
    # ── 设计工作室 / studio ──────────────────────────────
    ("buck", "https://buck.co", "Buck", ["studio", "motion", "creative"], "studio"),
    ("hugeinc", "https://www.hugeinc.com", "Huge", ["agency", "product"], "studio"),
    ("rga", "https://www.rga.com", "R/GA", ["agency", "brand"], "studio"),
    ("ideo", "https://www.ideo.com", "IDEO", ["studio", "product"], "studio"),
    ("frog", "https://www.frog.co", "Frog", ["studio", "product"], "studio"),
    ("fantasy", "https://fantasy.co", "Fantasy", ["agency", "product"], "studio"),
    ("moving-brands", "https://www.movingbrands.com", "Moving Brands", ["brand", "studio"], "studio"),
    ("wieden-kennedy", "https://www.wk.com", "Wieden+Kennedy", ["agency", "advertising"], "studio"),
    ("droga5", "https://droga5.com", "Droga5", ["agency", "advertising"], "studio"),
    ("studio-dumbar", "https://studiodumbar.com", "Studio Dumbar", ["brand", "motion"], "studio"),
    ("build-in-amsterdam", "https://www.buildinamsterdam.com", "Build in Amsterdam", ["agency", "ecommerce"], "studio"),
    ("north-kingdom", "https://www.northkingdom.com", "North Kingdom", ["agency", "creative"], "studio"),
    ("firstborn", "https://www.firstborn.com", "Firstborn", ["agency", "creative"], "studio"),
    ("your-majesty", "https://www.yourmajesty.co", "Your Majesty", ["agency", "creative"], "studio"),
    ("jam3", "https://www.jam3.com", "Jam3", ["agency", "creative"], "studio"),
    ("use-all-five", "https://useallfive.com", "Use All Five", ["studio", "digital"], "studio"),
    ("exo-ape", "https://www.exoape.com", "Exo Ape", ["studio", "webgl"], "studio"),
    ("merci-michel", "https://www.merci-michel.com", "Merci-Michel", ["studio", "creative"], "studio"),
    ("toyfight", "https://toyfight.co", "ToyFight", ["studio", "creative"], "studio"),
    ("dia-studio", "https://dia.tv", "DIA Studio", ["studio", "motion", "type"], "studio"),
    ("gretel", "https://gretelny.com", "Gretel", ["brand", "studio"], "studio"),
    ("mucho", "https://wearemucho.com", "Mucho", ["brand", "studio"], "studio"),
    ("order", "https://order.design", "Order", ["brand", "studio"], "studio"),
    ("bond", "https://bond-agency.com", "Bond", ["brand", "studio"], "studio"),
    ("cobe", "https://cobedesign.com", "COBE", ["studio", "creative"], "studio"),
    ("antinomy", "https://antinomy.studio", "Antinomy Studio", ["studio", "webgl"], "studio"),
    ("robin-noguier", "https://www.robin-noguier.com", "Robin Noguier", ["portfolio", "webgl"], "studio"),
    ("bruno-simon", "https://bruno-simon.com", "Bruno Simon", ["portfolio", "webgl", "3d"], "studio"),
    ("collins-nyc", "https://www.wearecollins.com", "COLLINS", ["brand", "studio"], "studio"),
    ("ueno", "https://www.ueno.co", "Ueno", ["agency", "product"], "studio"),

    # ── 字体厂 / type foundry ────────────────────────────
    ("hoefler-co", "https://www.typography.com", "Hoefler&Co", ["type", "foundry"], "type"),
    ("frere-jones", "https://frerejones.com", "Frere-Jones Type", ["type", "foundry"], "type"),
    ("typotheque", "https://www.typotheque.com", "Typotheque", ["type", "foundry", "editorial"], "type"),
    ("production-type", "https://productiontype.com", "Production Type", ["type", "foundry"], "type"),
    ("swiss-typefaces", "https://www.swisstypefaces.com", "Swiss Typefaces", ["type", "foundry"], "type"),
    ("lineto", "https://lineto.com", "Lineto", ["type", "foundry"], "type"),
    ("milieu-grotesque", "https://www.milieugrotesque.com", "Milieu Grotesque", ["type", "foundry"], "type"),
    ("205tf", "https://www.205.tf", "205TF", ["type", "foundry"], "type"),
    ("displaay", "https://displaay.net", "Displaay", ["type", "foundry"], "type"),
    ("general-type", "https://www.generaltypestudio.com", "General Type Studio", ["type", "foundry"], "type"),
    ("newglyph", "https://newglyph.com", "Newglyph", ["type", "foundry"], "type"),
    ("typenetwork", "https://www.typenetwork.com", "Type Network", ["type", "foundry"], "type"),

    # ── 设计感 SaaS / 开发者工具 / tech product ──────────
    ("retool", "https://retool.com", "Retool", ["saas", "dev"], "saas"),
    ("vanta", "https://www.vanta.com", "Vanta", ["saas", "security"], "saas"),
    ("ramp", "https://ramp.com", "Ramp", ["fintech", "saas"], "saas"),
    ("brex", "https://www.brex.com", "Brex", ["fintech", "saas"], "saas"),
    ("workos", "https://workos.com", "WorkOS", ["saas", "dev"], "saas"),
    ("temporal", "https://temporal.io", "Temporal", ["dev", "infra"], "saas"),
    ("upstash", "https://upstash.com", "Upstash", ["dev", "infra"], "saas"),
    ("netlify", "https://www.netlify.com", "Netlify", ["dev", "infra"], "saas"),
    ("statsig", "https://www.statsig.com", "Statsig", ["saas", "dev"], "saas"),
    ("amplitude", "https://amplitude.com", "Amplitude", ["saas", "analytics"], "saas"),
    ("mixpanel", "https://mixpanel.com", "Mixpanel", ["saas", "analytics"], "saas"),
    ("segment", "https://segment.com", "Segment", ["saas", "data"], "saas"),
    ("plaid", "https://plaid.com", "Plaid", ["fintech", "saas"], "saas"),
    ("polar", "https://polar.sh", "Polar", ["dev", "saas"], "saas"),
    ("lemon-squeezy", "https://www.lemonsqueezy.com", "Lemon Squeezy", ["saas", "payments"], "saas"),
    ("loops", "https://loops.so", "Loops", ["saas", "email"], "saas"),
    ("knock", "https://knock.app", "Knock", ["dev", "saas"], "saas"),
    ("attio", "https://attio.com", "Attio", ["saas", "crm"], "saas"),
    ("coda", "https://coda.io", "Coda", ["productivity", "saas"], "saas"),
    ("obsidian", "https://obsidian.md", "Obsidian", ["productivity", "notes"], "saas"),
    ("capacities", "https://capacities.io", "Capacities", ["productivity", "notes"], "saas"),
    ("heptabase", "https://heptabase.com", "Heptabase", ["productivity", "notes"], "saas"),
    ("todoist", "https://todoist.com", "Todoist", ["productivity", "saas"], "saas"),
    ("things", "https://culturedcode.com/things", "Things", ["productivity", "app"], "saas"),
    ("spline", "https://spline.design", "Spline", ["design", "3d", "tool"], "saas"),
    ("rive", "https://rive.app", "Rive", ["design", "motion", "tool"], "saas"),
    ("tldraw", "https://www.tldraw.com", "tldraw", ["design", "tool"], "saas"),
    ("excalidraw", "https://excalidraw.com", "Excalidraw", ["design", "tool"], "saas"),
    ("whimsical", "https://whimsical.com", "Whimsical", ["design", "tool"], "saas"),
    ("builder", "https://www.builder.io", "Builder.io", ["dev", "design", "tool"], "saas"),
    ("relume", "https://www.relume.io", "Relume", ["design", "tool"], "saas"),
    ("gamma", "https://gamma.app", "Gamma", ["productivity", "ai"], "saas"),
    ("tome", "https://tome.app", "Tome", ["productivity", "ai"], "saas"),
    ("cargo", "https://cargo.site", "Cargo", ["design", "portfolio", "tool"], "saas"),
    ("godly", "https://godly.website", "Godly", ["design", "gallery"], "saas"),
    ("savee", "https://savee.it", "Savee", ["design", "gallery"], "saas"),
    ("layers", "https://layers.to", "Layers", ["design", "community"], "saas"),

    # ── AI 产品 / AI product ─────────────────────────────
    ("writer", "https://writer.com", "Writer", ["ai", "saas"], "ai"),
    ("synthesia", "https://www.synthesia.io", "Synthesia", ["ai", "video"], "ai"),
    ("heygen", "https://www.heygen.com", "HeyGen", ["ai", "video"], "ai"),
    ("hume", "https://www.hume.ai", "Hume AI", ["ai", "voice"], "ai"),
    ("harvey", "https://www.harvey.ai", "Harvey", ["ai", "legal"], "ai"),
    ("ideogram", "https://ideogram.ai", "Ideogram", ["ai", "image"], "ai"),
    ("leonardo-ai", "https://leonardo.ai", "Leonardo.Ai", ["ai", "image"], "ai"),
    ("recraft", "https://www.recraft.ai", "Recraft", ["ai", "design"], "ai"),
    ("playground-ai", "https://playground.com", "Playground", ["ai", "image"], "ai"),
    ("bolt", "https://bolt.new", "Bolt", ["ai", "dev"], "ai"),
    ("windsurf", "https://windsurf.com", "Windsurf", ["ai", "dev"], "ai"),
    ("magic-dev", "https://magic.dev", "Magic", ["ai", "dev"], "ai"),
    ("cognition", "https://www.cognition.ai", "Cognition", ["ai", "dev"], "ai"),
    ("create-xyz", "https://www.create.xyz", "Create", ["ai", "dev"], "ai"),
    ("poe", "https://poe.com", "Poe", ["ai", "chat"], "ai"),
    ("pi-ai", "https://pi.ai", "Pi", ["ai", "chat"], "ai"),

    # ── web3 / crypto（设计感强的）───────────────────────
    ("opensea", "https://opensea.io", "OpenSea", ["web3", "nft"], "web3"),
    ("magic-eden", "https://magiceden.io", "Magic Eden", ["web3", "nft"], "web3"),
    ("arbitrum", "https://arbitrum.io", "Arbitrum", ["web3", "infra"], "web3"),
    ("aave", "https://aave.com", "Aave", ["web3", "defi"], "web3"),
    ("ledger", "https://www.ledger.com", "Ledger", ["web3", "hardware"], "web3"),
    ("metamask", "https://metamask.io", "MetaMask", ["web3", "wallet"], "web3"),
    ("safe", "https://safe.global", "Safe", ["web3", "wallet"], "web3"),
    ("alchemy", "https://www.alchemy.com", "Alchemy", ["web3", "infra"], "web3"),
    ("farcaster", "https://www.farcaster.xyz", "Farcaster", ["web3", "social"], "web3"),
    ("lens", "https://www.lens.xyz", "Lens", ["web3", "social"], "web3"),

    # ── 时尚 / 奢侈 / fashion & luxury ───────────────────
    ("bottega-veneta", "https://www.bottegaveneta.com", "Bottega Veneta", ["fashion", "luxury"], "fashion"),
    ("balenciaga", "https://www.balenciaga.com", "Balenciaga", ["fashion", "luxury"], "fashion"),
    ("loewe", "https://www.loewe.com", "Loewe", ["fashion", "luxury"], "fashion"),
    ("celine", "https://www.celine.com", "Celine", ["fashion", "luxury"], "fashion"),
    ("burberry", "https://www.burberry.com", "Burberry", ["fashion", "luxury"], "fashion"),
    ("off-white", "https://www.off---white.com", "Off-White", ["fashion", "streetwear"], "fashion"),
    ("a-cold-wall", "https://www.a-cold-wall.com", "A-COLD-WALL*", ["fashion", "streetwear"], "fashion"),
    ("stone-island", "https://www.stoneisland.com", "Stone Island", ["fashion", "streetwear"], "fashion"),
    ("our-legacy", "https://www.ourlegacy.com", "Our Legacy", ["fashion"], "fashion"),
    ("norse-projects", "https://www.norseprojects.com", "Norse Projects", ["fashion"], "fashion"),
    ("cos", "https://www.cos.com", "COS", ["fashion", "retail"], "fashion"),
    ("arket", "https://www.arket.com", "Arket", ["fashion", "retail"], "fashion"),
    ("ganni", "https://www.ganni.com", "Ganni", ["fashion"], "fashion"),
    ("the-row", "https://www.therow.com", "The Row", ["fashion", "luxury"], "fashion"),
    ("khaite", "https://khaite.com", "Khaite", ["fashion", "luxury"], "fashion"),
    ("telfar", "https://telfar.net", "Telfar", ["fashion"], "fashion"),
    ("represent", "https://representclo.com", "Represent", ["fashion", "streetwear"], "fashion"),
    ("rains", "https://www.rains.com", "Rains", ["fashion", "ecommerce"], "fashion"),
    ("veja", "https://www.veja-store.com", "Veja", ["fashion", "footwear"], "fashion"),
    ("hoka", "https://www.hoka.com", "Hoka", ["footwear", "sport"], "fashion"),
    ("salomon", "https://www.salomon.com", "Salomon", ["footwear", "sport"], "fashion"),
    ("arcteryx", "https://arcteryx.com", "Arc'teryx", ["outdoor", "sport"], "fashion"),
    ("patagonia", "https://www.patagonia.com", "Patagonia", ["outdoor", "ecommerce"], "fashion"),
    ("new-balance", "https://www.newbalance.com", "New Balance", ["footwear", "sport"], "fashion"),

    # ── 美妆 / 护肤 / 香氛 ───────────────────────────────
    ("byredo", "https://www.byredo.com", "Byredo", ["beauty", "fragrance"], "beauty"),
    ("le-labo", "https://www.lelabofragrances.com", "Le Labo", ["beauty", "fragrance"], "beauty"),
    ("diptyque", "https://www.diptyqueparis.com", "Diptyque", ["beauty", "fragrance"], "beauty"),
    ("typology", "https://typology.com", "Typology", ["beauty", "skincare"], "beauty"),
    ("merit", "https://www.meritbeauty.com", "Merit", ["beauty"], "beauty"),
    ("ilia", "https://www.iliabeauty.com", "Ilia", ["beauty"], "beauty"),
    ("starface", "https://starface.world", "Starface", ["beauty"], "beauty"),
    ("topicals", "https://mytopicals.com", "Topicals", ["beauty", "skincare"], "beauty"),
    ("jones-road", "https://www.jonesroadbeauty.com", "Jones Road", ["beauty"], "beauty"),
    ("prose", "https://prose.com", "Prose", ["beauty", "haircare"], "beauty"),
    ("dae", "https://daehair.com", "Dae", ["beauty", "haircare"], "beauty"),

    # ── 食品饮料 DTC / food & beverage ───────────────────
    ("recess", "https://www.takearecess.com", "Recess", ["beverage", "dtc"], "fnb"),
    ("poppi", "https://www.drinkpoppi.com", "Poppi", ["beverage", "dtc"], "fnb"),
    ("ghia", "https://ghia.com", "Ghia", ["beverage", "dtc"], "fnb"),
    ("de-soi", "https://www.desoi.com", "De Soi", ["beverage", "dtc"], "fnb"),
    ("spindrift", "https://www.drinkspindrift.com", "Spindrift", ["beverage", "dtc"], "fnb"),
    ("aura-bora", "https://www.aurabora.com", "Aura Bora", ["beverage", "dtc"], "fnb"),
    ("athletic-brewing", "https://athleticbrewing.com", "Athletic Brewing", ["beverage", "dtc"], "fnb"),
    ("fly-by-jing", "https://flybyjing.com", "Fly By Jing", ["food", "dtc"], "fnb"),
    ("brightland", "https://brightland.co", "Brightland", ["food", "dtc"], "fnb"),
    ("our-place", "https://fromourplace.com", "Our Place", ["home", "dtc"], "fnb"),
    ("caraway", "https://www.carawayhome.com", "Caraway", ["home", "dtc"], "fnb"),
    ("great-jones", "https://greatjones.co", "Great Jones", ["home", "dtc"], "fnb"),

    # ── 编辑 / 杂志 / 媒体 ───────────────────────────────
    ("monocle", "https://monocle.com", "Monocle", ["editorial", "magazine"], "editorial"),
    ("kinfolk", "https://www.kinfolk.com", "Kinfolk", ["editorial", "magazine"], "editorial"),
    ("cereal", "https://readcereal.com", "Cereal", ["editorial", "magazine"], "editorial"),
    ("apartamento", "https://www.apartamentomagazine.com", "Apartamento", ["editorial", "magazine"], "editorial"),
    ("another-magazine", "https://www.anothermag.com", "AnOther", ["editorial", "fashion"], "editorial"),
    ("dazed", "https://www.dazeddigital.com", "Dazed", ["editorial", "fashion"], "editorial"),
    ("highsnobiety", "https://www.highsnobiety.com", "Highsnobiety", ["editorial", "streetwear"], "editorial"),
    ("hypebeast", "https://hypebeast.com", "Hypebeast", ["editorial", "streetwear"], "editorial"),
    ("eye-on-design", "https://eyeondesign.aiga.org", "Eye on Design", ["editorial", "design"], "editorial"),
    ("typewolf", "https://www.typewolf.com", "Typewolf", ["editorial", "type"], "editorial"),
    ("fonts-in-use", "https://fontsinuse.com", "Fonts In Use", ["editorial", "type"], "editorial"),
    ("aeon", "https://aeon.co", "Aeon", ["editorial", "longform"], "editorial"),
    ("atlas-obscura", "https://www.atlasobscura.com", "Atlas Obscura", ["editorial", "travel"], "editorial"),
    ("the-marginalian", "https://www.themarginalian.org", "The Marginalian", ["editorial", "longform"], "editorial"),
    ("bloomberg", "https://www.bloomberg.com", "Bloomberg", ["editorial", "news"], "editorial"),

    # ── 设计画廊 / showcase ──────────────────────────────
    ("awwwards", "https://www.awwwards.com", "Awwwards", ["design", "gallery"], "showcase"),
    ("siteinspire", "https://www.siteinspire.com", "SiteInspire", ["design", "gallery"], "showcase"),
    ("the-fwa", "https://thefwa.com", "The FWA", ["design", "gallery"], "showcase"),
    ("httpster", "https://httpster.net", "Httpster", ["design", "gallery"], "showcase"),
    ("minimal-gallery", "https://minimal.gallery", "Minimal Gallery", ["design", "gallery"], "showcase"),
    ("brutalist-websites", "https://brutalistwebsites.com", "Brutalist Websites", ["design", "gallery"], "showcase"),
    ("one-page-love", "https://onepagelove.com", "One Page Love", ["design", "gallery"], "showcase"),
    ("refero", "https://refero.design", "Refero", ["design", "gallery"], "showcase"),
    ("footer-design", "https://www.footer.design", "Footer", ["design", "gallery"], "showcase"),

    # ── 美术馆 / 文化 / 艺术 ─────────────────────────────
    ("guggenheim", "https://www.guggenheim.org", "Guggenheim", ["museum", "art"], "culture"),
    ("tate", "https://www.tate.org.uk", "Tate", ["museum", "art"], "culture"),
    ("metmuseum", "https://www.metmuseum.org", "The Met", ["museum", "art"], "culture"),
    ("whitney", "https://whitney.org", "Whitney", ["museum", "art"], "culture"),
    ("sfmoma", "https://www.sfmoma.org", "SFMOMA", ["museum", "art"], "culture"),
    ("rijksmuseum", "https://www.rijksmuseum.nl", "Rijksmuseum", ["museum", "art"], "culture"),
    ("louisiana", "https://louisiana.dk", "Louisiana", ["museum", "art"], "culture"),
    ("serpentine", "https://www.serpentinegalleries.org", "Serpentine", ["museum", "art"], "culture"),
    ("design-museum", "https://designmuseum.org", "Design Museum", ["museum", "design"], "culture"),
    ("cooper-hewitt", "https://www.cooperhewitt.org", "Cooper Hewitt", ["museum", "design"], "culture"),
    ("new-museum", "https://www.newmuseum.org", "New Museum", ["museum", "art"], "culture"),
    ("the-broad", "https://www.thebroad.org", "The Broad", ["museum", "art"], "culture"),
    ("barbican", "https://www.barbican.org.uk", "Barbican", ["culture", "art"], "culture"),

    # ── 建筑 / 家具 / 工业设计 ───────────────────────────
    ("herman-miller", "https://www.hermanmiller.com", "Herman Miller", ["furniture", "design"], "design"),
    ("knoll", "https://www.knoll.com", "Knoll", ["furniture", "design"], "design"),
    ("muuto", "https://www.muuto.com", "Muuto", ["furniture", "design"], "design"),
    ("hay", "https://hay.dk", "HAY", ["furniture", "design"], "design"),
    ("gubi", "https://gubi.com", "Gubi", ["furniture", "design"], "design"),
    ("and-tradition", "https://www.andtradition.com", "&Tradition", ["furniture", "design"], "design"),
    ("fritz-hansen", "https://fritzhansen.com", "Fritz Hansen", ["furniture", "design"], "design"),
    ("audo", "https://audocph.com", "Audo Copenhagen", ["furniture", "design"], "design"),
    ("ferm-living", "https://fermliving.com", "Ferm Living", ["furniture", "home"], "design"),
    ("normann-copenhagen", "https://www.normann-copenhagen.com", "Normann Copenhagen", ["furniture", "design"], "design"),
    ("artek", "https://www.artek.fi", "Artek", ["furniture", "design"], "design"),
    ("usm", "https://www.usm.com", "USM", ["furniture", "design"], "design"),
    ("vitsoe", "https://www.vitsoe.com", "Vitsœ", ["furniture", "design"], "design"),
    ("vitra", "https://www.vitra.com", "Vitra", ["furniture", "design"], "design"),
    ("flos", "https://flos.com", "Flos", ["lighting", "design"], "design"),
    ("louis-poulsen", "https://www.louispoulsen.com", "Louis Poulsen", ["lighting", "design"], "design"),
    ("moooi", "https://www.moooi.com", "Moooi", ["furniture", "design"], "design"),
    ("article", "https://www.article.com", "Article", ["furniture", "ecommerce"], "design"),
    ("blu-dot", "https://www.bludot.com", "Blu Dot", ["furniture", "ecommerce"], "design"),
    ("big", "https://big.dk", "BIG", ["architecture", "studio"], "design"),
    ("snohetta", "https://snohetta.com", "Snøhetta", ["architecture", "studio"], "design"),
    ("heatherwick", "https://www.heatherwick.com", "Heatherwick Studio", ["architecture", "studio"], "design"),
    ("oma", "https://www.oma.com", "OMA", ["architecture", "studio"], "design"),
    ("mvrdv", "https://www.mvrdv.nl", "MVRDV", ["architecture", "studio"], "design"),
    ("zaha-hadid", "https://www.zaha-hadid.com", "Zaha Hadid Architects", ["architecture", "studio"], "design"),
    ("foster-partners", "https://www.fosterandpartners.com", "Foster + Partners", ["architecture", "studio"], "design"),
    ("kengo-kuma", "https://kkaa.co.jp", "Kengo Kuma", ["architecture", "studio"], "design"),

    # ── 硬件 / 工业设计品牌 ──────────────────────────────
    ("nothing", "https://nothing.tech", "Nothing", ["hardware", "product"], "hardware"),
    ("bang-olufsen", "https://www.bang-olufsen.com", "Bang & Olufsen", ["hardware", "audio"], "hardware"),
    ("sonos", "https://www.sonos.com", "Sonos", ["hardware", "audio"], "hardware"),
    ("dyson", "https://www.dyson.com", "Dyson", ["hardware", "product"], "hardware"),
    ("leica", "https://leica-camera.com", "Leica", ["hardware", "camera"], "hardware"),
    ("polaroid", "https://www.polaroid.com", "Polaroid", ["hardware", "camera"], "hardware"),
    ("master-dynamic", "https://www.masterdynamic.com", "Master & Dynamic", ["hardware", "audio"], "hardware"),
    ("nomad", "https://nomadgoods.com", "Nomad", ["hardware", "accessories"], "hardware"),
    ("peak-design", "https://www.peakdesign.com", "Peak Design", ["hardware", "accessories"], "hardware"),
    ("bellroy", "https://bellroy.com", "Bellroy", ["accessories", "ecommerce"], "hardware"),
    ("monos", "https://monos.com", "Monos", ["luggage", "ecommerce"], "hardware"),
    ("nintendo", "https://www.nintendo.com", "Nintendo", ["gaming", "brand"], "hardware"),

    # ── 出行 / 航天 / mobility ───────────────────────────
    ("porsche", "https://www.porsche.com", "Porsche", ["automotive", "luxury"], "mobility"),
    ("mclaren", "https://www.mclaren.com", "McLaren", ["automotive", "luxury"], "mobility"),
    ("rolls-royce", "https://www.rolls-roycemotorcars.com", "Rolls-Royce", ["automotive", "luxury"], "mobility"),
    ("genesis", "https://www.genesis.com", "Genesis", ["automotive"], "mobility"),
    ("rivian", "https://rivian.com", "Rivian", ["automotive", "ev"], "mobility"),
    ("lucid", "https://lucidmotors.com", "Lucid", ["automotive", "ev"], "mobility"),
    ("polestar", "https://www.polestar.com", "Polestar", ["automotive", "ev"], "mobility"),
    ("waymo", "https://waymo.com", "Waymo", ["automotive", "av"], "mobility"),
    ("blue-origin", "https://www.blueorigin.com", "Blue Origin", ["aerospace"], "mobility"),
    ("boom", "https://boomsupersonic.com", "Boom Supersonic", ["aerospace"], "mobility"),
    ("anduril", "https://www.anduril.com", "Anduril", ["defense", "tech"], "mobility"),

    # ── 钟表 / watches ───────────────────────────────────
    ("rolex", "https://www.rolex.com", "Rolex", ["watches", "luxury"], "watches"),
    ("audemars-piguet", "https://www.audemarspiguet.com", "Audemars Piguet", ["watches", "luxury"], "watches"),
    ("omega", "https://www.omegawatches.com", "Omega", ["watches", "luxury"], "watches"),
    ("tag-heuer", "https://www.tagheuer.com", "TAG Heuer", ["watches", "luxury"], "watches"),

    # ── 创作者 / 工程师作品集 ────────────────────────────
    ("lynn-fisher", "https://lynnandtonic.com", "Lynn Fisher", ["portfolio", "css"], "portfolio"),
    ("josh-comeau", "https://www.joshwcomeau.com", "Josh Comeau", ["portfolio", "blog"], "portfolio"),
    ("paco", "https://paco.me", "Paco Coursey", ["portfolio", "dev"], "portfolio"),
    ("rauchg", "https://rauchg.com", "Guillermo Rauch", ["portfolio", "dev"], "portfolio"),
    ("leerob", "https://leerob.com", "Lee Robinson", ["portfolio", "dev"], "portfolio"),
    ("delba", "https://delba.dev", "Delba de Oliveira", ["portfolio", "dev"], "portfolio"),
    ("emil-kowalski", "https://emilkowal.ski", "Emil Kowalski", ["portfolio", "dev"], "portfolio"),
    ("nerdy-dev", "https://nerdy.dev", "Adam Argyle", ["portfolio", "css"], "portfolio"),
    ("jhey", "https://jhey.dev", "Jhey Tompkins", ["portfolio", "css"], "portfolio"),

    # ════════ 第二轮扩充：render-friendly（headless 抓得出来，奔 500 net）════════
    # ── 开发者工具 / 基础设施 / 数据库 ──────────────────
    ("grafana", "https://grafana.com", "Grafana", ["dev", "observability"], "saas"),
    ("sourcegraph", "https://sourcegraph.com", "Sourcegraph", ["dev", "code"], "saas"),
    ("codesandbox", "https://codesandbox.io", "CodeSandbox", ["dev", "tool"], "saas"),
    ("stackblitz", "https://stackblitz.com", "StackBlitz", ["dev", "tool"], "saas"),
    ("gitpod", "https://www.gitpod.io", "Gitpod", ["dev", "tool"], "saas"),
    ("pulumi", "https://www.pulumi.com", "Pulumi", ["dev", "infra"], "saas"),
    ("cockroach", "https://www.cockroachlabs.com", "Cockroach Labs", ["dev", "db"], "saas"),
    ("tinybird", "https://www.tinybird.co", "Tinybird", ["dev", "data"], "saas"),
    ("dbt", "https://www.getdbt.com", "dbt", ["dev", "data"], "saas"),
    ("appwrite", "https://appwrite.io", "Appwrite", ["dev", "infra"], "saas"),
    ("pocketbase", "https://pocketbase.io", "PocketBase", ["dev", "infra"], "saas"),
    ("xata", "https://xata.io", "Xata", ["dev", "db"], "saas"),
    ("auth0", "https://auth0.com", "Auth0", ["dev", "auth"], "saas"),
    ("stytch", "https://stytch.com", "Stytch", ["dev", "auth"], "saas"),
    ("doppler", "https://www.doppler.com", "Doppler", ["dev", "infra"], "saas"),
    ("infisical", "https://infisical.com", "Infisical", ["dev", "security"], "saas"),
    ("depot", "https://depot.dev", "Depot", ["dev", "infra"], "saas"),
    ("e2b", "https://e2b.dev", "E2B", ["dev", "ai"], "saas"),
    ("browserbase", "https://www.browserbase.com", "Browserbase", ["dev", "ai"], "saas"),
    ("algolia", "https://www.algolia.com", "Algolia", ["dev", "search"], "saas"),
    ("meilisearch", "https://www.meilisearch.com", "Meilisearch", ["dev", "search"], "saas"),
    ("typesense", "https://typesense.org", "Typesense", ["dev", "search"], "saas"),
    ("qdrant", "https://qdrant.tech", "Qdrant", ["dev", "ai"], "saas"),
    ("pinecone", "https://www.pinecone.io", "Pinecone", ["dev", "ai"], "saas"),
    ("weaviate", "https://weaviate.io", "Weaviate", ["dev", "ai"], "saas"),
    ("redis", "https://redis.io", "Redis", ["dev", "db"], "saas"),
    # ── AI / ML 平台 ────────────────────────────────────
    ("fireworks", "https://fireworks.ai", "Fireworks AI", ["ai", "infra"], "ai"),
    ("baseten", "https://www.baseten.co", "Baseten", ["ai", "infra"], "ai"),
    ("wandb", "https://wandb.ai", "Weights & Biases", ["ai", "ml"], "ai"),
    ("langchain", "https://www.langchain.com", "LangChain", ["ai", "dev"], "ai"),
    ("dify", "https://dify.ai", "Dify", ["ai", "dev"], "ai"),
    ("vapi", "https://vapi.ai", "Vapi", ["ai", "voice"], "ai"),
    ("cartesia", "https://cartesia.ai", "Cartesia", ["ai", "voice"], "ai"),
    ("deepgram", "https://deepgram.com", "Deepgram", ["ai", "voice"], "ai"),
    ("assemblyai", "https://www.assemblyai.com", "AssemblyAI", ["ai", "voice"], "ai"),
    ("udio", "https://www.udio.com", "Udio", ["ai", "music"], "ai"),
    ("lindy", "https://www.lindy.ai", "Lindy", ["ai", "agent"], "ai"),
    ("relevance", "https://relevanceai.com", "Relevance AI", ["ai", "agent"], "ai"),
    ("n8n", "https://n8n.io", "n8n", ["dev", "automation"], "ai"),
    # ── 设计 / 创意工具 ─────────────────────────────────
    ("lottiefiles", "https://lottiefiles.com", "LottieFiles", ["design", "motion"], "saas"),
    ("penpot", "https://penpot.app", "Penpot", ["design", "tool"], "saas"),
    ("modyfi", "https://www.modyfi.com", "Modyfi", ["design", "tool"], "saas"),
    ("vectary", "https://www.vectary.com", "Vectary", ["design", "3d"], "saas"),
    ("womp", "https://womp.com", "Womp", ["design", "3d"], "saas"),
    ("jitter", "https://jitter.video", "Jitter", ["design", "motion"], "saas"),
    ("phase", "https://phase.com", "Phase", ["design", "motion"], "saas"),
    ("play", "https://createwithplay.com", "Play", ["design", "tool"], "saas"),
    ("uizard", "https://uizard.io", "Uizard", ["design", "ai"], "saas"),
    ("format", "https://www.format.com", "Format", ["design", "portfolio"], "saas"),
    # ── 生产力 / 笔记 / 邮件 ────────────────────────────
    ("reclaim", "https://reclaim.ai", "Reclaim", ["productivity", "saas"], "saas"),
    ("usemotion", "https://www.usemotion.com", "Motion", ["productivity", "saas"], "saas"),
    ("morgen", "https://www.morgen.so", "Morgen", ["productivity", "saas"], "saas"),
    ("vimcal", "https://www.vimcal.com", "Vimcal", ["productivity", "saas"], "saas"),
    ("shortwave", "https://www.shortwave.com", "Shortwave", ["productivity", "email"], "saas"),
    ("missive", "https://missiveapp.com", "Missive", ["productivity", "email"], "saas"),
    ("spark", "https://sparkmailapp.com", "Spark", ["productivity", "email"], "saas"),
    ("anytype", "https://anytype.io", "Anytype", ["productivity", "notes"], "saas"),
    ("logseq", "https://logseq.com", "Logseq", ["productivity", "notes"], "saas"),
    ("mem", "https://get.mem.ai", "Mem", ["productivity", "notes"], "saas"),
    # ── 金融科技 / 商业 ─────────────────────────────────
    ("rippling", "https://www.rippling.com", "Rippling", ["fintech", "saas"], "saas"),
    ("deel", "https://www.deel.com", "Deel", ["fintech", "saas"], "saas"),
    ("gusto", "https://gusto.com", "Gusto", ["fintech", "saas"], "saas"),
    ("pleo", "https://www.pleo.io", "Pleo", ["fintech", "saas"], "saas"),
    ("qonto", "https://qonto.com", "Qonto", ["fintech", "saas"], "saas"),
    ("monzo", "https://monzo.com", "Monzo", ["fintech", "bank"], "saas"),
    ("n26", "https://n26.com", "N26", ["fintech", "bank"], "saas"),
    ("checkout", "https://www.checkout.com", "Checkout.com", ["fintech", "payments"], "saas"),
    ("gocardless", "https://gocardless.com", "GoCardless", ["fintech", "payments"], "saas"),
    ("mollie", "https://www.mollie.com", "Mollie", ["fintech", "payments"], "saas"),
    ("modern-treasury", "https://www.moderntreasury.com", "Modern Treasury", ["fintech", "saas"], "saas"),
    ("increase", "https://increase.com", "Increase", ["fintech", "api"], "saas"),
    ("column", "https://column.com", "Column", ["fintech", "bank"], "saas"),
    # ── CMS / 内容 / 建站 ───────────────────────────────
    ("ghost", "https://ghost.org", "Ghost", ["cms", "publishing"], "saas"),
    ("substack", "https://substack.com", "Substack", ["publishing", "newsletter"], "saas"),
    ("beehiiv", "https://www.beehiiv.com", "beehiiv", ["publishing", "newsletter"], "saas"),
    ("buttondown", "https://buttondown.com", "Buttondown", ["publishing", "newsletter"], "saas"),
    ("kit", "https://kit.com", "Kit", ["publishing", "newsletter"], "saas"),
    ("contentful", "https://www.contentful.com", "Contentful", ["cms", "dev"], "saas"),
    ("storyblok", "https://www.storyblok.com", "Storyblok", ["cms", "dev"], "saas"),
    ("prismic", "https://prismic.io", "Prismic", ["cms", "dev"], "saas"),
    ("payload", "https://payloadcms.com", "Payload", ["cms", "dev"], "saas"),
    ("hygraph", "https://hygraph.com", "Hygraph", ["cms", "dev"], "saas"),
    ("strapi", "https://strapi.io", "Strapi", ["cms", "dev"], "saas"),
    ("directus", "https://directus.io", "Directus", ["cms", "dev"], "saas"),
    ("webstudio", "https://webstudio.is", "Webstudio", ["design", "nocode"], "saas"),
    ("super", "https://super.so", "Super", ["nocode", "tool"], "saas"),
    ("carrd", "https://carrd.co", "Carrd", ["nocode", "tool"], "saas"),
    # ── 分析 / 数据可视 ─────────────────────────────────
    ("plausible", "https://plausible.io", "Plausible", ["analytics", "dev"], "saas"),
    ("fathom", "https://usefathom.com", "Fathom", ["analytics", "dev"], "saas"),
    ("umami", "https://umami.is", "Umami", ["analytics", "dev"], "saas"),
    ("june", "https://www.june.so", "June", ["analytics", "saas"], "saas"),
    ("highlight", "https://www.highlight.io", "Highlight", ["dev", "observability"], "saas"),
    ("metabase", "https://www.metabase.com", "Metabase", ["data", "bi"], "saas"),
    ("motherduck", "https://motherduck.com", "MotherDuck", ["data", "db"], "saas"),
    ("evidence", "https://evidence.dev", "Evidence", ["data", "bi"], "saas"),
    # ── 通信 / 社区 / 消息 ──────────────────────────────
    ("discord", "https://discord.com", "Discord", ["community", "chat"], "saas"),
    ("circle", "https://circle.so", "Circle", ["community", "saas"], "saas"),
    ("livekit", "https://livekit.io", "LiveKit", ["dev", "rtc"], "saas"),
    ("daily", "https://www.daily.co", "Daily", ["dev", "rtc"], "saas"),
    ("getstream", "https://getstream.io", "Stream", ["dev", "chat"], "saas"),
    ("ably", "https://ably.com", "Ably", ["dev", "realtime"], "saas"),
    ("courier", "https://www.courier.com", "Courier", ["dev", "notifications"], "saas"),
    ("novu", "https://novu.co", "Novu", ["dev", "notifications"], "saas"),
    ("postmark", "https://postmarkapp.com", "Postmark", ["dev", "email"], "saas"),
    # ── 杂项设计感产品 / 品牌 ───────────────────────────
    ("gitlab", "https://about.gitlab.com", "GitLab", ["dev", "devops"], "saas"),
    ("incident", "https://incident.io", "incident.io", ["dev", "ops"], "saas"),
    ("granola", "https://www.granola.ai", "Granola", ["ai", "productivity"], "ai"),
    ("loom", "https://www.loom.com", "Loom", ["productivity", "video"], "saas"),
    ("tella", "https://www.tella.com", "Tella", ["productivity", "video"], "saas"),
    ("zen-browser", "https://zen-browser.app", "Zen Browser", ["browser", "product"], "saas"),
    ("raindrop", "https://raindrop.io", "Raindrop", ["productivity", "bookmarks"], "saas"),
    ("matter", "https://hq.getmatter.com", "Matter", ["productivity", "reading"], "saas"),
    ("omnivore", "https://omnivore.app", "Omnivore", ["productivity", "reading"], "saas"),
    ("tiptap", "https://tiptap.dev", "Tiptap", ["dev", "editor"], "saas"),
    ("linear-method", "https://linear.app/method", "The Linear Method", ["product", "method"], "saas"),
]


def host_of(u):
    return urllib.parse.urlparse(u).netloc.lower().replace("www.", "")


def main():
    dry = "--dry-run" in sys.argv
    existing_slugs, existing_hosts = set(), set()
    for p in glob.glob(str(SITES / "*.json")):
        d = json.loads(Path(p).read_text(encoding="utf-8"))
        existing_slugs.add(d["id"])
        existing_hosts.add(host_of(d.get("url", "")))

    new, skipped = [], []
    seen_slugs, seen_hosts = set(), set()
    for slug, url, title, tags, cat in C:
        h = host_of(url)
        if slug in existing_slugs or h in existing_hosts:
            skipped.append((slug, "已在库"))
            continue
        if slug in seen_slugs or h in seen_hosts:
            skipped.append((slug, "清单内重复"))
            continue
        seen_slugs.add(slug)
        seen_hosts.add(h)
        new.append((slug, url, title, tags, cat))

    # 分类统计
    by_cat = {}
    for slug, url, title, tags, cat in new:
        by_cat.setdefault(cat, []).append(slug)
    print(f"候选 {len(C)} · 去重后新建 {len(new)} · 跳过 {len(skipped)}")
    for cat in sorted(by_cat):
        print(f"  {cat:12} {len(by_cat[cat]):3}  {' '.join(by_cat[cat][:8])}{' …' if len(by_cat[cat])>8 else ''}")
    total_after = len(existing_slugs) + len(new)
    print(f"\n现有 {len(existing_slugs)} + 新 {len(new)} = {total_after} 站（目标 500）")

    if dry:
        print("\n[dry-run] 未建文件。去掉 --dry-run 实际建 stub。")
        return

    made = 0
    for slug, url, title, tags, cat in new:
        path = SITES / f"{slug}.json"
        if path.exists():
            continue
        # 注意：schema 是 additionalProperties:false —— 只能写 schema 允许的字段。
        # category 仅用于上面的分类统计（来自 C 元组），不写进 stub。added_at 不是 added。
        path.write_text(json.dumps({
            "id": slug, "schema_version": "0.3", "url": url, "title": title,
            "image": "", "tags": tags, "status": "pending",
            "added_at": datetime.now().strftime("%Y-%m-%d"),
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        made += 1
    print(f"\n✓ 建了 {made} 个 stub。下一步：export ANTHROPIC_*; bash scripts/upgrade-batch.sh（可断点续跑）")


if __name__ == "__main__":
    main()
