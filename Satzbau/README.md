# Satzbau · 德语造句练习 — macOS 桌面版

基于 Electron 的 AI 德语造句练习应用，功能与网页版完全一致（主页导航 / 按难度·词表出题 / 语法要点 / AI 逐词批改 / 词典 / 生词本 / 句子收藏夹 / 历史 / 错题本 / 统计 / 设置）。

## 安装

- 安装包：`../Satzbau-1.0.0-arm64.dmg`（本目录外的 `德语造句网页/` 文件夹下）
- 双击 DMG → 把 **Satzbau.app** 拖进 **Applications** 即可。
- 首次打开如提示「无法验证开发者」，请右键 → 打开。应用为本地构建、无签名证书，属正常现象。

## 架构（前后端 + 自有存储）

```
renderer/index.html  ──（window.__satzbau）──▶  preload.js  ──IPC──▶  main.js（主进程/后端）
     前端 UI（功能逻辑）                        安全桥                  │
                                                        ┌──────────────┴──────────────┐
                                                        │ 存储后端                     │  AI 后端
                                                        │  JSON 文件：                 │  fetch → api.deepseek.com
                                                        │  ~/Library/Application      │
                                                        │  Support/Satzbau/           │
                                                        │  satzbau-data.json          │
                                                        └─────────────────────────────┘
```

- **前端**：原 `index.html` 的单页应用，所有练习逻辑不变。
- **后端（主进程）**：
  - **自有存储系统**：数据保存为 JSON 文件（`Application Support/Satzbau/satzbau-data.json`），内存缓存 + 防抖 200ms 落盘 + 临时文件原子写入，退出前强制写盘。覆盖设置 / 历史 / 词表 / 生词本 / 句子收藏五个数据键，语义与 localStorage 完全一致。
  - **AI 请求转发**：DeepSeek 请求由主进程发出（不再由渲染层直连），统一处理超时 / 401 / 429 错误。
- **安全桥（preload）**：`contextIsolation: true`、`sandbox: true`，仅通过 `window.__satzbau` 暴露：
  - `window.__satzbau.storage.getItem/setItem/removeItem/clear`（同步）
  - `window.__satzbau.ai.call(opts)`（异步）

> 渲染层的 `localStorage` 已被桥接到后端文件存储；在浏览器直接打开 `renderer/index.html` 时，没有 `__satzbau` 桥，仍会回退到原生 localStorage + 直连 fetch，网页版行为不受影响。

## 开发 / 重新打包

```bash
npm install                 # 安装依赖（国内网络建议先设镜像）
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

npm start                   # 开发运行
npm run pack                # 打包 .app → dist/mac-arm64/Satzbau.app
```

打包 DMG（无证书，使用 ad-hoc 签名）：

```bash
npx electron-builder --mac dir
codesign --force --deep --sign - dist/mac-arm64/Satzbau.app

rm -rf /tmp/satzbau-dmg-staging && mkdir -p /tmp/satzbau-dmg-staging
cp -R dist/mac-arm64/Satzbau.app /tmp/satzbau-dmg-staging/
ln -s /Applications /tmp/satzbau-dmg-staging/Applications
hdiutil create -volname "Satzbau" -srcfolder /tmp/satzbau-dmg-staging -ov -format UDZO -fs HFS+ dist/Satzbau-1.0.0-arm64.dmg
codesign --force --sign - dist/Satzbau-1.0.0-arm64.dmg
```

## 自检（可选）

```bash
SATZBAU_SMOKE=1 npm start            # 存储后端读写自检
SATZBAU_SMOKE_AI=1 npm start         # AI 通路（真实调用 DeepSeek）自检
```

## 隐私

- 练习记录仅保存在本机 `~/Library/Application Support/Satzbau/satzbau-data.json`。
- 题目与作答会发送至 DeepSeek API 用于生成与批改。
