# phone-as-body 桌面安装包 + 云中继 + 多手柄 · 设计文档

> 日期：2026-08-21 · 状态：已与作者确认
> 目标读者：接手实现的 AI / 开发者。本文档自包含。

## 0. 背景与动机

phone-as-body 当前以"浏览器在线"形态运行：电脑打开网页、手机扫码接管。存在三个问题：

1. **加载大**：桌面端每次在线加载全部资源（村庄 LFS 资源约 49MB + MediaPipe wasm），体验慢；
2. **不支持多人**：`server/session-registry.js` 的房间模型为 `desktopId + controllerId` 两个字段，协议层写死一房一手柄，无法支撑《快门镇》（5 人同室、大屏 + 5 手机）等多人形态；
3. **手机直连电脑走不通**：手机浏览器要陀螺仪/摄像头权限必须 HTTPS 安全上下文，局域网自签证书在客人手机上无法优雅信任。

决定：做成**可下载桌面安装包**，本地跑全部游戏逻辑；手机扫码后连**云中继**（作者自有域名 `tokenxapp.com` + 腾讯云国内轻量服务器 4C4G），由云转发到桌面应用；同时把会话层升级为**多手柄**。

## 1. 现状事实（已核实）

- 技术栈：Express 5 + Socket.IO 4 + Vite 6（ESM），桌面端 Three.js + Rapier，手机端 MediaPipe Tasks Vision；
- 连接拓扑：桌面与手机同源连接 Node 服务；高频输入优先 WebRTC DataChannel（controls/hand 不可靠通道、voice 有序通道），Socket.IO 为信令与后备通道；
- 房间码：6 位数字（`session-registry.js:14`），桌面 `desktopCreate` 创建，手机 `controllerJoin` 加入；
- 二维码 URL：`PUBLIC_CONTROLLER_ORIGIN` 环境变量或 `location.origin`（`src/desktop/PhoneSession.js:103`）；
- 测试基线：75 个测试文件、856 项测试；
- 服务器地域：国内（未备案域名，80/443/8080 会被拦截 → 采用非标端口 8443）；
- 域名：`tokenxapp.com`，NS 在阿里云（hichina），尚未添加 A 记录。

## 2. 总体架构

```
手机浏览器 ──HTTPS/WSS──> play.tokenxapp.com:8443
                          （云中继：托管手机端页面 + 房间注册表 + 哑管道）
                                │ 按房间码 + 房间密钥配对
                                ▼ WSS 隧道
                    桌面应用（Electron 内跑完整本地服务）
```

原则：

- **游戏权威状态 100% 在桌面本地**，云中继是哑管道，无游戏逻辑、无数据库；
- 手机页面由云端加载（正规 TLS → 传感器/摄像头权限无障碍）；
- 手机与电脑同 WiFi 时，WebRTC ICE 走 host candidate 局域网直连，高频输入不经云（现有代码已实现，保留）；
- 手机在蜂窝网络时控制流走云中继（延迟可接受，本游戏为倾斜行走类非 twitch 手感）。

## 3. 组件设计

### 3.1 桌面应用（Electron）

- 主进程以 `ELECTRON_RUN_AS_NODE=1` 子进程方式原样运行 `server/index.js`（`NODE_ENV=production`），**服务端代码零语义改动**；
- 应用窗口加载 `http://localhost:4174`（端口沿用，可用 `PORT` 覆盖）；
- 打包内容：Vite `dist` 产物、`public/`（村庄模型、MediaPipe wasm）、`server/`、生产依赖（electron-builder `files` 白名单）；
- electron-builder 产出 **Windows NSIS 安装包**（中文品牌名"手机即身体"，约 80-100MB 下载量）；
- 生命周期：单实例锁；子进程崩溃自动重启（指数退避）；应用退出杀干净子进程；窗口关闭即退出；
- 配置：云中继地址内置默认 `https://play.tokenxapp.com:8443`，允许本地覆盖（设置文件/env），便于开发调试。

### 3.2 云中继（新目录 `relay/`，独立部署）

轻量 Node 服务（Express + Socket.IO），运行于腾讯云 8443 端口，TLS 证书由 acme.sh 阿里云 DNS-01 插件签发与续期，pm2 守护。

职责与接口：

- **静态托管手机端页面**：`/controller?room=CODE&k=KEY`（手机端构建产物；`io()` 连同源即连中继，无需改动连接目标）；
- **房间注册表**：`code → { desktopSocketId, secret, controllers: Set<socketId> }`，内存态即可；
- **桌面侧 Socket.IO 事件**：
  - `relayRegister { code, secret }`：桌面应用启动房间后向云注册（secret 由桌面生成）；
  - 之后双向转发：`controllerInput / controllerHand / controllerVoiceClip / controllerAction / rtcSignal / desktopEvent / peerStatus` 等，原事件名透传；
- **手机侧**：`controllerJoin { room, k }` → 校验 code 存在 + k 匹配 → 允许并通知桌面 `peerStatus { connected, slot }`；
- **鉴权**：房间密钥 `k`（≥16 字符随机）仅存在于二维码 URL 与桌面内存中；无 k 或 k 错误拒绝加入（防陌生人劫持房间码）；
- **上限**：每房间最多 8 个手柄；房间桌面断线后 TTL 60s 清理；
- 中继不做输入校验/限频（那本来就是本地 server 的职责，透传即可）。

### 3.3 本地服务多人改造（`server/session-registry.js` + `server/index.js`）

- 房间模型：`controllerId` → `controllers: Map<socketId, ControllerState>`；`ControllerState = { slot, input, handSeq, handEpoch, voiceSeq, lastVoiceAcceptedAt, deviceToken, joinedAt }`；
- `attachController(code, socketId, deviceToken)`：
  - 新设备：分配最小空闲 slot（0-7）；
  - 已知 deviceToken 重连：回收原 slot（顶掉旧连接）；
  - 房满：拒绝（`room-full`）；
- 输入路由：`controllerInput` 等事件处理改为按 socketId 查 controllers Map；发给桌面的消息携带 `slot`；
- `peerStatus` 变为按手柄粒度：`{ connected, slot, deviceToken }`；
- 协议常量新增：`MAX_CONTROLLERS = 8`、`controllerJoin` 增加 `deviceToken` 字段（向后兼容：缺省视为新设备）；
- **桥接层**（云中继形态下的关键件）：本地 server 新增"远端手柄适配器"——中继隧道消息在本地注入为等效 socket 事件，使桌面端 `PhoneSession` 无感知（对它来说手柄还是"连在本机 io 上"）。

### 3.4 桌面客户端改造（`src/desktop/PhoneSession.js`）

- `PhoneSession` → 内部聚合 `PhoneSessionManager`（管 N 个手柄会话）；对外保留现有事件与 `currentInput()` API，**默认绑定 slot 0（P1）**，现有单人游戏代码不动；
- 新增 API：`manager.onSession(slot)` / `sessions()`，供未来《快门镇》类多人玩法使用；
- WebRTC：按手柄各建一条 PeerConnection（≤8 条 DataChannel 组，量级无压力）；
- 二维码 URL：优先取云中继 origin（打包形态下 `PUBLIC_CONTROLLER_ORIGIN` 由 Electron 主进程注入）。

### 3.5 手机端改造（`src/controller/`）

- 连接目标不变（同源 = 云中继或本地服务，两形态都成立）；
- `controllerJoin` 附带持久化 `deviceToken`（localStorage），实现断线重连找回槽位；
- UI 显示槽位徽标（P1-P8）。

## 4. 明确不做（范围纪律）

- 不动现有单人游戏内容（NPC、剧情、场景、玩法）；
- 不做 macOS 安装包（架构不排斥，后续再说）；
- 云中继不做用户体系、数据库、持久化、鉴权框架；
- 不做 ICP 备案（走 8443 非标端口规避，风险已知悉并接受）。

## 5. 验收标准

1. `npm test` 全绿（registry/协议相关测试随改动同步更新）；
2. 中继单测：注册配对、密钥校验（对/错/缺）、多手柄并发转发、桌面断线 TTL 清理；
3. 端到端真机：安装包 → 启动 → 手机扫码 → 控制正常（含同 WiFi WebRTC 直连）→ 第二台手机加入显示 P2、两台同时输入互不串扰 → 一台断网重连接回原槽位；
4. 安装包在干净 Windows 机器上可安装、启动、卸载；
5. 云上部署后，手机走蜂窝网络可正常游玩（中继路径）。

## 6. 待调参数（开放问题）

- 房间密钥长度/编码（暂定 16 字符 base64url）；
- 房间 TTL（暂定桌面断线 60s）；
- 手柄上限（暂定 8，为快门镇 5 人 + 余量）；
- 中继 origin 内置值与覆盖方式（暂定设置文件）。

## 7. 风险与对策

- **腾讯云封锁非标端口**：实测为准；若被拦，备选更高端口或换香港地域轻量服务器；
- **跨网 WebRTC 失败**（不同 NAT）：Socket.IO 通道本就是后备路径，功能不降级，仅延迟升高；后续可加 coturn；
- **Electron 子进程稳定性**：崩溃自动重启 + 单实例锁；服务端代码零改动降低回归面；
- **856 个测试的回归**：多人改造集中在 registry 与协议层，测试同步改写而非绕过。
