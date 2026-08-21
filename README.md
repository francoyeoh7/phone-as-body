# 手机即身体

> 跨屏沉浸式交互游戏 | Phone as Body

《手机即身体》是一款运行在浏览器中的跨屏 3D 游戏。电脑负责呈现第一人称世界，玩家扫描二维码后，无需安装 App，手机就会成为身体输入设备：触控负责移动和交互，陀螺仪负责视角，后置摄像头负责手部动作识别，麦克风负责与场景角色对话。

项目探索的核心问题不是“把虚拟按键搬到手机”，而是让一块人人熟悉的屏幕承担手、眼、方向和声音等身体能力，让现实动作直接进入游戏。

## 核心体验

- **扫码即连接**：电脑创建临时房间，手机通过二维码进入同一会话。
- **身体化移动**：整块手机屏幕承担移动与视角控制，支持陀螺仪校准、灵敏度调节和断线归零。
- **手部识别**：MediaPipe 在手机本地分析后置摄像头画面，将左手姿态映射为电脑端第一人称手臂。
- **边缘物品栏**：从手机右侧边缘向左滑动可唤出并选择道具，交互方向和行程按单手人体工学设计。
- **跨屏叙事**：包含完整 3D 村庄、NPC 空间语音、剧情门交互、敲门视频和 13 页场内演示文稿。
- **低延迟传输**：高频控制数据优先通过 WebRTC DataChannel 发送，并以 Socket.IO 维持房间、信令和可靠事件。
- **键鼠后备**：没有手机时仍可用键鼠进入游戏，便于开发和演示。

## 工作方式

```text
手机浏览器                         电脑浏览器
触控 / 陀螺仪 / 摄像头 / 麦克风  ->  3D 世界 / 角色 / 剧情 / 声音
             \                     /
              WebRTC + Socket.IO
                     |
                 Node.js 服务
```

游戏权威状态保留在电脑端。手机发送经过限频和校验的控制数据；摄像头原始画面只在手机本地参与识别，不上传、不保存。

## 技术栈

- Three.js：3D 场景、灯光、动画与第一人称渲染
- Rapier 3D：玩家碰撞与场景物理
- MediaPipe Tasks Vision：手机端手部关键点识别
- WebRTC DataChannel：低延迟连续控制输入
- Socket.IO：配对、信令、可靠动作与状态同步
- Web Audio：环境声、空间语音与交互反馈
- Express + Vite：服务端与前端构建
- Vitest：逻辑、协议、场景和交互回归测试

## 环境要求

- Node.js 20 或更高版本
- Git LFS（仓库包含大型 3D 场景资源）
- 桌面端 Chrome、Edge 或 Safari
- 手机端 iPhone Safari 或 Android Chrome
- 真机陀螺仪和摄像头能力需要 HTTPS 安全上下文

## 获取项目

```bash
git lfs install
git clone https://github.com/francoyeoh7/phone-as-body.git
cd phone-as-body
npm install
```

Windows PowerShell 本地开发：

```powershell
$env:NODE_ENV = "development"
node server/index.js
```

macOS / Linux 本地开发：

```bash
NODE_ENV=development node server/index.js
```

电脑打开 [http://localhost:4174](http://localhost:4174)。本机键鼠测试可以使用 HTTP；手机真机连接应使用 HTTPS 域名，并设置 `PUBLIC_CONTROLLER_ORIGIN`，使电脑端二维码指向该安全地址。

### 固定域名 HTTPS

服务本身监听 HTTP，由反向代理负责 TLS。已有域名时可用 Caddy 自动申请并续期证书：

```text
game.example.com {
  reverse_proxy 127.0.0.1:4174
}
```

启动服务时把二维码地址设成同一个域名：

```powershell
$env:NODE_ENV = "production"
$env:PUBLIC_CONTROLLER_ORIGIN = "https://game.example.com"
npm run build
node server/index.js
```

Cloudflare Tunnel、Nginx 或其他 HTTPS 反代也可以使用同样的结构；关键是域名必须稳定、代理转发到 `127.0.0.1:4174`，并将 `PUBLIC_CONTROLLER_ORIGIN` 设置为浏览器实际访问的 HTTPS 根地址。

## 手机操作

1. 电脑端创建房间后，用手机相机扫描二维码，在 Safari 或 Chrome 中直接打开。
2. 点击“允许并开始”，允许动作/方向传感器、后置摄像头和麦克风；首次授权或切回后台后按页面提示重新校准。
3. 在游戏控制面上长按并拖动：拖动方向控制移动，转动手机控制视角；短按是当前目标的后备交互。
4. 从右侧边缘向左滑动打开道具栏，继续向左移动选择道具，松手提交；从左向右滑动或取消会放弃本次选择。
5. 到 NPC 附近时按住底部“按住说话”按钮，松开后发送语音；设置中可以调整体感灵敏度、转向平滑度和重新校准方向。

后置摄像头的手部识别和剧情动作只使用本机低分辨率帧。摄像头不可用时，游戏会保留短按等后备交互；陀螺仪未授权时不会进入体感游戏。

## 语音与隐私

- 浏览器原生语音识别只作为低延迟字幕辅助，具体处理方式由当前浏览器供应商决定。
- 按住说话产生的短音频片段会通过当前游戏服务的 `/api/npc/transcribe` 转写；服务不把音频写入项目目录或持久化存储。
- 配置 `OPENAI_API_KEY` 时，服务端会将该片段转发到 OpenAI 的音频转写接口，并可能使用 `/api/npc/perform` 或 `/api/npc/realtime` 生成 NPC 回应。未配置时不会调用 OpenAI；Windows WAV 可回退到本机 Windows Speech，临时文件处理后删除。
- 如不希望发送语音，不要按住“按住说话”；关闭麦克风权限不影响移动、视角、道具栏和键鼠后备。

## 可选 AI 配置

NPC 的实时语音与生成式对话需要 OpenAI API；没有密钥时，主体游戏、手机控制、手势和预置 NPC 语音仍可运行。

```powershell
Copy-Item .env.example .env.local
```

在本地 `.env.local` 中填写所需变量。真实密钥不得提交到 Git；仓库已默认忽略所有本地环境文件。

## 验证

```bash
npm test
npm run build
npm run verify:village
```

当前发布基线包含 75 个测试文件，856 项测试通过，1 项按环境跳过。村庄资源另有尺寸与 SHA-256 完整性校验。

## 桌面键鼠后备

- `W` / `A` / `S` / `D`：移动
- `C` 或 `Ctrl`：蹲下
- 鼠标：点击画面锁定指针后控制视线，`Escape` 可退出指针锁定
- `E`：交互
- `F`：开关手电筒
- `R`：重新校准方向
- `Space`：守门阶段的按住/松开后备输入
- `Escape`：暂停或继续游戏

## 桌面安装包与云中继

- `npm run dist:win` 产出 Windows NSIS 安装包（`release/phone-as-body-Setup-<version>.exe`），游戏与资源全部本地化，启动即玩。
- 安装包默认把二维码指向云中继 `https://play.tokenxapp.com:8443`；手机扫码后经云端隧道接管，电脑与手机同 WiFi 时高频输入（陀螺仪视角与手势帧）仍走 WebRTC 局域网直连。
- 云中继部署见 `relay/README.md`（腾讯云 + acme.sh DNS-01 + pm2，非标端口 8443 规避备案墙）。
- 会话层支持最多 8 个手柄（P1-P8 槽位徽标显示），断线凭设备令牌找回原槽位；当前单人游戏绑定主手柄（最小已连接槽位）。
- 开发调试：`npm run electron:dev`；覆盖默认云端地址用环境变量 `RELAY_URL` / `PUBLIC_CONTROLLER_ORIGIN`。

## 项目状态

当前版本已经打通桌面端游戏、手机控制器、手部追踪、道具栏、NPC 对话、剧情门和场内演示文稿。固定域名部署与服务器托管将作为独立发布步骤推进，不依赖临时隧道地址。

## 许可与资源

仓库包含受单独条款约束的场景、角色、材质和运行时资源，因此保持为私有仓库。来源和许可记录见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 以及各资源目录中的 `PROVENANCE.md`、`LICENSE.md` 和 `README.md`。
