/* ================================================================
   Satzbau · preload — 渲染层与主进程（后端）之间的安全桥
   ----------------------------------------------------------------
   渲染层通过 window.__satzbau 访问：
     - __satzbau.storage.getItem / setItem / removeItem / clear
       同步读写（IPC sendSync），语义与 localStorage 一致
     - __satzbau.storage.info() / openDir()   存储信息与打开数据目录
     - __satzbau.ai.call(opts)   DeepSeek 请求，经主进程转发
     - __satzbau.tts.speak(opts) macOS 原生 say 朗读（Invoke）
   ================================================================ */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const storage = {
  getItem: (key) => ipcRenderer.sendSync("storage:get", String(key)),
  setItem: (key, value) => ipcRenderer.sendSync("storage:set", String(key), String(value)),
  removeItem: (key) => ipcRenderer.sendSync("storage:remove", String(key)),
  clear: () => ipcRenderer.sendSync("storage:clear"),
  info: () => ipcRenderer.invoke("storage:info"),
  openDir: () => ipcRenderer.invoke("storage:openDir"),
};

const ai = {
  call: (opts) => ipcRenderer.invoke("ai:call", opts || {}),
};

const tts = {
  speak: (opts) => ipcRenderer.invoke("tts:speak", opts || {}),
};

contextBridge.exposeInMainWorld("__satzbau", {
  storage,
  ai,
  tts,
  platform: process.platform,
  isMac: process.platform === "darwin",
  version: "1.2.0",
});
