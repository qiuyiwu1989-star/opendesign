# 部署 OpenDesign

完整 runbook。首次约 10 分钟，之后每次增量更新一行命令。

## 配置

- **主域名**: `opendesign.cc`
- 服务器: `146.56.239.22`（2026-08 从 43.159.171.3 迁来，旧机器已下线）
- 部署目标的唯一事实来源：`scripts/deploy-target.env` —— 换机器只改那一个文件，
  五个部署脚本都 source 它（以前各自硬编码，迁完漏改过一轮）
- SSH 账户: `ubuntu`
- Web 根目录: `/var/www/opendesign.cc`
- TLS: Let's Encrypt TLS-ALPN 自动续期（`opendesign-acme-renew.timer`）
- 旧域名 `style.qiuyiwu.com`: 301 跳转到 opendesign.cc

---

## 首次部署（10 分钟）

### 1. DNS 配置

进 opendesign.cc 的 DNS 提供商，加：

```
类型: A     主机: @      值: 146.56.239.22
类型: A     主机: www    值: 146.56.239.22
```

等 DNS 生效：

```bash
dig +short opendesign.cc        # 应返回 146.56.239.22
dig +short www.opendesign.cc    # 应返回 146.56.239.22
```

### 2. 一次性服务器初始化

```bash
./scripts/initial-setup.sh
```

会创建 `/var/www/opendesign.cc/`，装 nginx 配置，reload。

### 3. 申请 HTTPS（DNS 生效后）

`opendesign.cc` 的 80 端口在部分公网验证节点会被云平台备案页接管，因此不要使用
HTTP-01。使用 `acme.sh` 的 TLS-ALPN 模式在 443 端口签发，证书安装到独立目录；
签发期间 Nginx 会短暂停止，post hook 会无条件恢复服务。

```bash
sudo apt-get install -y acme.sh
sudo mkdir -p /root/.acme.sh /etc/nginx/certs/opendesign.cc
sudo env -u SUDO_COMMAND -u SUDO_USER -u SUDO_UID -u SUDO_GID HOME=/root \
  acme.sh --home /root/.acme.sh --config-home /root/.acme.sh \
  --register-account --server letsencrypt -m hi@opendesign.cc
sudo env -u SUDO_COMMAND -u SUDO_USER -u SUDO_UID -u SUDO_GID HOME=/root \
  acme.sh --home /root/.acme.sh --config-home /root/.acme.sh \
  --issue --server letsencrypt --alpn -d opendesign.cc -d www.opendesign.cc \
  --keylength ec-256 --pre-hook 'systemctl stop nginx' --post-hook 'systemctl start nginx'
sudo env -u SUDO_COMMAND -u SUDO_USER -u SUDO_UID -u SUDO_GID HOME=/root \
  acme.sh --home /root/.acme.sh --config-home /root/.acme.sh \
  --install-cert -d opendesign.cc --ecc \
  --key-file /etc/nginx/certs/opendesign.cc/privkey.pem \
  --fullchain-file /etc/nginx/certs/opendesign.cc/fullchain.pem \
  --reloadcmd 'systemctl reload nginx'
sudo install -m 0644 deploy/opendesign-acme-renew.service /etc/systemd/system/
sudo install -m 0644 deploy/opendesign-acme-renew.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now opendesign-acme-renew.timer
```

验收：`nginx -t` 成功、证书剩余时间超过 21 天，并且 timer 为 `active (waiting)`。

### 4. 首次推送

```bash
./scripts/deploy.sh
```

打开 `https://opendesign.cc`。

### 5. 配 style.qiuyiwu.com 的 301 跳转

```bash
./scripts/configure-redirect.sh
```

让 https://style.qiuyiwu.com/* → 301 → https://opendesign.cc/*

---

## 日常更新

```bash
./scripts/deploy.sh
```

脚本会打包以下文件并推送：

- `index.html`
- `styles.css`
- `app.js`
- `sites.js`
- `supabase-config.js`
- `favicon.svg`（如有）

⚠️ 如果新增运行时文件，加进 [scripts/deploy.sh](scripts/deploy.sh) 顶部的 `FILES=()` 数组。

---

## 部署 Supabase Edge Function（独立流程）

跟前端部署解耦。详见 [supabase/functions/analyze-site/README.md](supabase/functions/analyze-site/README.md)。

简要：

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref nlsvjigoltvyfpqsbygh
supabase secrets set ANTHROPIC_API_KEY=...
supabase secrets set ANTHROPIC_BASE_URL=...    # 用 MiMo 时填这个
supabase secrets set ANTHROPIC_MODEL=...
supabase functions deploy analyze-site --no-verify-jwt
```

---

## 故障排查

### `./scripts/deploy.sh` 报 `Permission denied (publickey,password)`
- 检查 SSH_OPTS 里 `publickey` 是否在最前；`ssh -v ubuntu@146.56.239.22` 看握手

### 部署完打开是 404 或空白
- SSH 上去看 `/var/www/opendesign.cc/` 里有没有文件
- 看 `sudo tail -n 50 /var/log/nginx/opendesign.cc.error.log`

### Supabase / microlink 在生产报 CSP 错误
- 在 [deploy/nginx-opendesign.cc.conf](deploy/nginx-opendesign.cc.conf) 的 `connect-src` 里加上需要的域名
- 重新跑 initial-setup 装新配置

### style.qiuyiwu.com 没跳过来
- SSH 上去看 `/etc/nginx/sites-available/style.qiuyiwu.com` 是否被替换为 redirect-only config
- `sudo nginx -t && sudo systemctl reload nginx`
