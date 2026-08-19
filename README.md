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

## 项目状态

当前版本已经打通桌面端游戏、手机控制器、手部追踪、道具栏、NPC 对话、剧情门和场内演示文稿。固定域名部署与服务器托管将作为独立发布步骤推进，不依赖临时隧道地址。

## 许可与资源

仓库包含受单独条款约束的场景、角色、材质和运行时资源，因此保持为私有仓库。来源和许可记录见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 以及各资源目录中的 `PROVENANCE.md`、`LICENSE.md` 和 `README.md`。
