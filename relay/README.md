# 云中继部署手册（腾讯云 · play.tokenxapp.com:8443）

云中继是哑管道：托管手机端页面 + 按房间码配对 + 双向转发。游戏逻辑全部在玩家自己的电脑上运行。

## 一次性准备

1. **DNS**：在阿里云 DNS 控制台为 `tokenxapp.com` 添加 A 记录：主机记录 `play` → 腾讯云服务器公网 IP。
2. **防火墙**：腾讯云轻量服务器控制台 → 防火墙 → 放行 TCP `8443`。
3. **Node**：服务器安装 Node.js 20+（nodesource 或官方二进制包）。
4. **证书（DNS-01 签发，不需要 80 端口，绕开备案墙）**：

   ```bash
   curl https://get.acme.sh | sh -s email=<你的邮箱>
   # 阿里云 RAM 创建 AccessKey（只需 DNS 解析权限），然后：
   export Ali_Key=<AccessKeyId>
   export Ali_Secret=<AccessKeySecret>
   mkdir -p /opt/phone-relay/certs
   ~/.acme.sh/acme.sh --issue --dns dns_ali -d play.tokenxapp.com
   ~/.acme.sh/acme.sh --install-cert -d play.tokenxapp.com \
     --key-file /opt/phone-relay/certs/key.pem \
     --fullchain-file /opt/phone-relay/certs/cert.pem \
     --reloadcmd "pm2 restart phone-relay || true"
   ```

## 每次发版

在开发机（仓库根目录）：

```bash
npm ci
npm run build   # 产出 dist/（含手机端页面与 wasm）
rsync -avz --delete dist/ server/ relay/ src/shared/ package.json package-lock.json <user>@<server-ip>:/opt/phone-relay/
```

在服务器：

```bash
cd /opt/phone-relay
npm ci --omit=dev
```

pm2 生态文件 `/opt/phone-relay/ecosystem.config.cjs`：

```js
module.exports = {
  apps: [{
    name: "phone-relay",
    script: "relay/index.mjs",
    cwd: "/opt/phone-relay",
    env: {
      PORT: "8443",
      DIST_DIR: "/opt/phone-relay/dist",
      TLS_CERT: "/opt/phone-relay/certs/cert.pem",
      TLS_KEY: "/opt/phone-relay/certs/key.pem",
    },
  }],
};
```

```bash
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

## 验证

```bash
curl https://play.tokenxapp.com:8443/api/health
# {"ok":true}
```

电脑端启动安装包 → 二维码指向 `https://play.tokenxapp.com:8443/controller?room=XXXXXX&k=YYYY` → 手机扫码进入控制页。

## 运维备注

- 证书续期：acme.sh 自带 cron，自动续期并 `pm2 restart phone-relay`
- 日志：`pm2 logs phone-relay`
- 已知取舍：桌面端网络抖动导致桥断连时，手机会看到"电脑端已关闭"，刷新页面重扫即可；房间在 60 秒内可被同一密钥重新注册
- 上限：每房间 8 手柄；同房间码 + 不同密钥会被拒绝（防劫持）
- 同 WiFi 场景下高频输入（陀螺仪/手势）走 WebRTC 局域网直连，不经过云
