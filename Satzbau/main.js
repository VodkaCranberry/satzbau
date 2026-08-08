/* ================================================================
   Satzbau · 德语造句练习 — macOS 桌面应用（主进程 / 后端）
   ----------------------------------------------------------------
   • 数据存储：JSON 文件，位于
       ~/Library/Application Support/Satzbau/satzbau-data.json
     内存缓存 + 防抖落盘 + 原子写入（临时文件 + 重命名）
     + 最多 3 份滚动备份（satzbau-data.json.bak1~3）
     + 主文件损坏时自动从最近备份恢复
   • 渲染进程通过 preload 暴露的 window.__satzbau 与后端交互：
       - window.__satzbau.storage.*  → 同步读写（IPC sendSync）
       - window.__satzbau.ai.call()  → DeepSeek 请求走后端（IPC invoke）
       - window.__satzbau.tts.speak()→ macOS 原生 say 语音（IPC invoke）
   ================================================================ */

"use strict";

const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

app.setName("Satzbau");

/* ---------- 单实例 ---------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  main();
}

/* ---------- 数据存储（后端） ---------- */
const DATA_KEYS = ["satzbau_settings", "satzbau_history", "satzbau_words", "satzbau_vocab", "satzbau_sentences"];
const BACKUP_COUNT = 3;

function dataFile() {
  return path.join(app.getPath("userData"), "satzbau-data.json");
}
function backupFile(i) {
  return dataFile() + ".bak" + i;
}

// store[key] = 字符串（与 localStorage 语义一致），缺失为 undefined
let store = {};
let saveTimer = null;

// 依次尝试候选文件，返回第一个可正常解析的对象
function tryLoad(paths) {
  for (const f of paths) {
    try {
      const raw = fs.readFileSync(f, "utf8");
      const d = JSON.parse(raw);
      if (d && typeof d === "object") return { path: f, data: d };
    } catch (e) { /* 跳过损坏/缺失文件 */ }
  }
  return null;
}

function loadStore() {
  const ok = tryLoad([dataFile(), backupFile(1), backupFile(2), backupFile(3)]);
  if (ok) {
    store = ok.data;
    if (ok.path !== dataFile()) {
      console.warn("[satzbau] 主数据文件损坏，已从备份恢复:", ok.path);
      scheduleSave(); // 立即用恢复的数据重建主文件
    }
  } else {
    store = {};
  }
}

function saveStore() {
  saveTimer = null;
  try {
    const f = dataFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, f);
    rotateBackups(f);
  } catch (e) {
    console.error("[satzbau] 保存数据失败:", e.message);
  }
}

// 滚动备份：主文件 → bak1，bak1 → bak2，bak2 → bak3（最多保留 3 份历史）
function rotateBackups(f) {
  try {
    if (fs.existsSync(backupFile(2))) fs.renameSync(backupFile(2), backupFile(3));
    if (fs.existsSync(backupFile(1))) fs.renameSync(backupFile(1), backupFile(2));
    fs.copyFileSync(f, backupFile(1));
  } catch (e) {
    console.error("[satzbau] 备份轮换失败:", e.message);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStore, 200);
}

/* ---------- IPC：存储 ---------- */
ipcMain.on("storage:get", (e, key) => {
  e.returnValue = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
});

ipcMain.on("storage:set", (e, key, value) => {
  store[key] = value;
  scheduleSave();
  e.returnValue = true;
});

ipcMain.on("storage:remove", (e, key) => {
  if (Object.prototype.hasOwnProperty.call(store, key)) delete store[key];
  scheduleSave();
  e.returnValue = true;
});

ipcMain.on("storage:clear", (e) => {
  store = {};
  scheduleSave();
  e.returnValue = true;
});

// 存储信息：数据文件路径、大小、备份列表（供设置页「数据存储」展示）
ipcMain.handle("storage:info", () => {
  const f = dataFile();
  let exists = false, size = 0;
  try { const st = fs.statSync(f); exists = st.size > 0; size = st.size; } catch (e) {}
  const backups = [];
  for (let i = 1; i <= BACKUP_COUNT; i++) {
    const p = backupFile(i);
    try {
      const st = fs.statSync(p);
      if (st.size > 0) backups.push({ i, size: st.size, mtime: st.mtimeMs });
    } catch (e) {}
  }
  return { path: f, exists, size, count: backups.length, backups };
});

// 在访达中打开数据目录
ipcMain.handle("storage:openDir", () => {
  const dir = path.dirname(dataFile());
  try {
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  } catch (e) {}
  return true;
});

/* ---------- IPC：TTS（macOS 原生 say，德语语音质量更佳） ---------- */
const MACOS_GERMAN_VOICES = ["Anna", "Petra", "Helena", "Yannick", "Markus", "Viktor", "Carolin", "Nathalie"];
const MACOS_VOICE_ALIAS = { "Google Deutsch": "Anna", "German (Germany)": "Anna" };

ipcMain.handle("tts:speak", (_evt, opts = {}) => {
  const text = String(opts.text || "").slice(0, 500);
  return new Promise((resolve) => {
    if (process.platform !== "darwin" || !text) return resolve({ ok: false, error: "unsupported" });
    let v = String(opts.voice || "");
    if (MACOS_VOICE_ALIAS[v]) v = MACOS_VOICE_ALIAS[v];
    // 仅当是合法的 macOS 德语语音名才传入，否则交给 say 默认（德语场景指定 Anna）
    if (!/^[A-Za-z][A-Za-z \-]{0,39}$/.test(v) || !MACOS_GERMAN_VOICES.includes(v)) v = "";
    if (!v && String(opts.lang || "").toLowerCase().startsWith("de")) v = "Anna";
    // 语速换算：网页 rate（0.9 ≈ 正常）→ say 的每分钟词数（≈175 wpm 为正常）
    const wpm = Math.max(60, Math.round(175 * (Number(opts.rate) || 0.9)));
    const args = [];
    if (v) args.push("-v", v);
    args.push("-r", String(wpm));
    args.push(text);
    const child = spawn("say", args);
    const to = setTimeout(() => { try { child.kill(); } catch (e) {} resolve({ ok: true }); }, 30000);
    child.on("error", () => { clearTimeout(to); resolve({ ok: false, error: "say unavailable" }); });
    child.on("close", (code) => { clearTimeout(to); resolve({ ok: code === 0 }); });
  });
});

/* ---------- IPC：DeepSeek AI（请求经后端，避免渲染层直连） ---------- */
ipcMain.handle("ai:call", async (_evt, opts = {}) => {
  const { apiKey, model, temperature, maxTokens, json, system, user } = opts;
  if (!apiKey) return { ok: false, error: "未配置 API Key，请在设置中填写。" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model: model || "deepseek-chat",
        temperature: temperature != null ? temperature : 0.8,
        max_tokens: maxTokens || 1600,
        response_format: json ? { type: "json_object" } : undefined,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (e2) {}
      if (res.status === 401) return { ok: false, error: "API Key 无效或已过期（401）。请在设置中检查。" };
      if (res.status === 429) return { ok: false, error: "请求过于频繁，请稍后再试（429）。" };
      return { ok: false, error: msg };
    }
    const data = await res.json();
    return { ok: true, content: data.choices[0].message.content };
  } catch (e) {
    if (e && e.name === "AbortError") return { ok: false, error: "请求超时，请重试。" };
    return { ok: false, error: (e && e.message) || String(e) };
  } finally {
    clearTimeout(timer);
  }
});

/* ---------- 窗口 ---------- */
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    title: "Satzbau · 德语造句练习",
    backgroundColor: "#f5f5f7",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => { win = null; });
  win.on("page-title-updated", (e) => e.preventDefault());

  // 外部链接一律交给系统浏览器；禁止窗口内跳走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file:")) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  win.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error("[satzbau] 页面加载失败:", code, desc);
  });
  win.webContents.on("preload-error", (_e, p, err) => {
    console.error("[satzbau] preload 错误:", p, err.message);
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // 内置自检（仅供开发/打包验证，正常使用不触发）
  if (process.env.SATZBAU_SMOKE) {
    win.webContents.once("did-finish-load", () => runSmokeTest());
  }
  if (process.env.SATZBAU_SMOKE_AI) {
    win.webContents.once("did-finish-load", () => runSmokeAiTest());
  }
}

/* ---------- 菜单 ---------- */
function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [{ label: app.name, submenu: [
          { role: "about", label: "关于 Satzbau" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide", label: "隐藏 Satzbau" },
          { role: "hideOthers", label: "隐藏其他" },
          { role: "unhide", label: "全部显示" },
          { type: "separator" },
          { role: "quit", label: "退出 Satzbau" },
        ] }]
      : []),
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "显示",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "切换全屏" },
      ],
    },
    { role: "windowMenu", label: "窗口" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- 自检 ---------- */
function runSmokeTest() {
  const run = win.webContents.executeJavaScript(`
    (async () => {
      window.localStorage.setItem("satzbau_settings", JSON.stringify({ theme: "light", model: "deepseek-chat" }));
      const v = window.localStorage.getItem("satzbau_settings");
      window.localStorage.removeItem("__smoke__");
      const native = !!(window.__satzbau && window.__satzbau.storage && window.__satzbau.ai);
      let tts = false, info = null;
      if (window.__satzbau && window.__satzbau.tts) {
        tts = typeof window.__satzbau.tts.speak === "function";
        try { info = await window.__satzbau.storage.info(); } catch (e) {}
      }
      return JSON.stringify({ storage: v, native: native, tts: tts, backups: info ? info.count : -1, title: document.title });
    })()
  `);
  run.then((r) => {
    console.log("SMOKE_RESULT " + r);
    app.exit(0);
  }).catch((e) => {
    console.error("SMOKE_ERROR " + e.message);
    app.exit(1);
  });
}

// AI 通路自检：渲染层 → preload → IPC → 主进程 fetch → DeepSeek → 返回
function runSmokeAiTest() {
  const run = win.webContents.executeJavaScript(`
    (async () => {
      const r = await window.__satzbau.ai.call({
        apiKey: "sk-e2e0f8a975ef4af6b9eb27e85323590a",
        model: "deepseek-chat",
        temperature: 0.5,
        maxTokens: 120,
        json: true,
        system: "你只返回一个 JSON 对象，不要输出任何其他内容。",
        user: '{\"ok\":true,\"msg\":\"hallo\"}'
      });
      return JSON.stringify(r);
    })()
  `);
  run.then((r) => {
    console.log("SMOKE_AI " + r);
    app.exit(0);
  }).catch((e) => {
    console.error("SMOKE_AI_ERROR " + e.message);
    app.exit(1);
  });
}

/* ---------- 生命周期 ---------- */
function main() {
  app.on("second-instance", () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    loadStore();
    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // 退出前落盘
  app.on("before-quit", () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveStore();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
