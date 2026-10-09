import { articleFromText, buildRequest, partitionArticle, parseResponse, DEFAULT_MODEL, MODELS, RUBRIC_VERSION } from "./lib/analysis.js";
import { callJev, validateKey } from "./lib/jev-client.js";

const EMPTY = { status: "idle", article: null, reports: [], error: "", progress: "", createdAt: "", cacheHit: false };
let state = { ...EMPTY }, currentJob = null, captureVersion = 0;
const ready = (async () => {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  ]);
  const saved = await chrome.storage.session.get("lensState");
  if (saved.lensState) state = saved.lensState;
  if (["reading", "analyzing"].includes(state.status)) {
    state = { ...state, status: "error", error: "上次分析已中断，正文已保留。请重新开始分析。", progress: "" };
    await chrome.storage.session.set({ lensState: state });
  }
})();

async function publish() {
  await chrome.storage.session.set({ lensState: state });
  chrome.runtime.sendMessage({ type: "lensUpdated" }).catch(() => {});
}

async function settings() {
  const [local, session] = await Promise.all([chrome.storage.local.get(["apiKey", "model"]), chrome.storage.session.get("apiKey")]);
  return { hasKey: !!(session.apiKey || local.apiKey), remember: !!local.apiKey, model: MODELS.includes(local.model) ? local.model : DEFAULT_MODEL };
}

async function keyValue() {
  const [local, session] = await Promise.all([chrome.storage.local.get("apiKey"), chrome.storage.session.get("apiKey")]);
  return session.apiKey || local.apiKey || "";
}

function trustedSender(sender) {
  // Extension UI can be a side panel or an extension tab; both are trusted by
  // their browser-provided extension ID and exact document URL, not tab presence.
  return sender.id === chrome.runtime.id && sender.url?.split("?")[0].split("#")[0] === chrome.runtime.getURL("panel.html");
}

export { trustedSender };

async function digest(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}

async function readTab(tab) {
  await ready;
  if (currentJob) throw new Error("请先取消当前分析，再读取另一篇文章。");
  const capture = ++captureVersion;
  state = { ...EMPTY, status: "reading", progress: "正在读取正文…" }; await publish();
  try {
    if (!Number.isInteger(tab?.id) || !/^https?:\/\//.test(tab.url || "")) throw new Error("该页面不能读取。请在普通网页打开文章后点击工具栏插件，或手动粘贴正文。");
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["vendor/Readability.js", "extractor.js"], world: "ISOLATED" });
    const extraction = results.at(-1)?.result;
    if (!extraction?.ok) throw new Error(extraction?.error || "没有读取到正文，请重新点击工具栏插件或粘贴正文。");
    const article = articleFromText(extraction.article.text, { ...extraction.article, tabId: tab.id });
    article.contentHash = await digest(article.text);
    if (capture !== captureVersion) return;
    state = { ...EMPTY, status: "ready", article }; await publish();
  } catch (error) {
    if (capture !== captureVersion) return;
    state = { ...EMPTY, status: "error", error: error.message?.includes("Cannot access") ? "Chrome 尚未授权读取此页。请在文章页面重新点击工具栏插件，或粘贴正文。" : String(error.message || "正文读取失败。") }; await publish();
  }
}

chrome.action.onClicked.addListener(tab => {
  // open() must run directly inside the user gesture, before any awaited work.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  ready.then(async () => {
    if (currentJob || state.status === "reading") { await publish(); return; }
    await readTab(tab);
  }).catch(async error => { state.error = error.message; await publish(); });
});

async function analyze(force = false) {
  if (currentJob) throw new Error("已有分析正在运行。");
  if (!state.article) throw new Error("请先读取或粘贴正文。");
  if (state.status === "reading") throw new Error("请等待本地正文读取完成。");
  const job = { id: crypto.randomUUID(), controller: new AbortController() };
  currentJob = job;
  try {
  const key = await keyValue();
  if (!key) throw new Error("请先在设置中填写 TypeSafe/Jev API Key。");
  const { model } = await settings();
  const article = state.article;
  const cacheKey = await digest(article.title + "\n" + article.text + "\n" + model + "\n" + RUBRIC_VERSION);
  const cached = (await chrome.storage.session.get("lensCache")).lensCache || [];
  const hit = cached.find(item => item.key === cacheKey);
  if (currentJob !== job) return;
  if (hit && !force) {
    state = { ...state, status: "done", reports: hit.reports, createdAt: hit.createdAt, cacheHit: true, error: "", progress: "" }; currentJob = null; await publish(); return;
  }
  const groups = partitionArticle(article);
  state = { ...state, status: "analyzing", reports: [], error: "", progress: `正在分析第 1 / ${groups.length} 组…`, cacheHit: false }; await publish();
  (async () => {
    const reports = [];
    try {
      for (const group of groups) {
        if (currentJob !== job) return;
        state.progress = `正在分析第 ${group.index + 1} / ${groups.length} 组…`; await publish();
        const response = await callJev(buildRequest(group, model), key, { signal: job.controller.signal, onRetry: () => { if (currentJob === job) { state.progress = "TypeSafe 限流或繁忙，稍后重试一次…"; publish().catch(() => {}); } } });
        reports.push(parseResponse(response, group));
        if (currentJob !== job) return;
        state = { ...state, reports: [...reports] }; await publish();
      }
      if (currentJob !== job) return;
      const createdAt = new Date().toISOString();
      state = { ...state, status: "done", reports, createdAt, progress: "", error: "" };
      await chrome.storage.session.set({ lensCache: [{ key: cacheKey, reports, createdAt }, ...cached.filter(item => item.key !== cacheKey)].slice(0, 5) });
      await publish();
    } catch (error) {
      if (currentJob !== job) return;
      state = { ...state, status: "error", reports, progress: "", error: String(error.message || "分析失败，请重试。") }; await publish();
    } finally { if (currentJob === job) currentJob = null; }
  })();
  } catch (error) { if (currentJob === job) currentJob = null; throw error; }
}

async function focusParagraph(paragraphId) {
  const article = state.article;
  const paragraph = article?.paragraphs.find(p => p.id === paragraphId);
  if (!paragraph || !Number.isInteger(article.tabId)) throw new Error("粘贴正文没有可定位的原网页。");
  const tab = await chrome.tabs.get(article.tabId);
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["vendor/Readability.js", "extractor.js"], world: "ISOLATED" });
  const current = results.at(-1)?.result;
  if (!current?.ok || current.article.url !== article.url || await digest(articleFromText(current.article.text, current.article).text) !== article.contentHash) throw new Error("原页面已改变或尚未授权，不能可靠定位。请回到文章重新点击插件读取。");
  await chrome.tabs.update(tab.id, { active: true });
  const occurrence = article.paragraphs.slice(0, article.paragraphs.indexOf(paragraph)).filter(p => p.text === paragraph.text).length;
  const located = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: ({ quote, occurrence }) => {
    const normalized = s => String(s || "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
    const needle = normalized(quote);
    const root = document.querySelector("#js_content") || document.body;
    const candidates = Array.from(root.querySelectorAll("p, li, h1, h2, h3, blockquote, section, div"));
    const matches = candidates.filter(el => normalized(el.innerText).includes(needle));
    const leaves = matches.filter(el => !matches.some(other => other !== el && el.contains(other)));
    const element = leaves[occurrence];
    if (!element) return false;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.animate([{ backgroundColor: "#f5d47c" }, { backgroundColor: "transparent" }], { duration: 4000, easing: "ease-out" });
    return true;
  }, args: [{ quote: paragraph.text, occurrence }], world: "ISOLATED" });
  if (!located[0]?.result) throw new Error("未能唯一定位该段落。请在正文预览中按段落编号查找。");
}

async function handle(message) {
  await ready;
  switch (message.type) {
    case "getState": return { state, settings: await settings() };
    case "read": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); await readTab(tab); return { state };
    }
    case "paste": {
      if (currentJob) throw new Error("请先取消当前分析。");
      captureVersion++;
      if (typeof message.text !== "string" || typeof message.title !== "string") throw new Error("粘贴内容格式错误。");
      const article = articleFromText(message.text, { title: message.title || "粘贴的文章", source: "manual", warnings: ["仅分析粘贴的内容。"] });
      article.contentHash = await digest(article.text); state = { ...EMPTY, status: "ready", article }; await publish(); return {};
    }
    case "saveKey": {
      if (currentJob) throw new Error("请先取消当前分析，再更换 Key。");
      if (!MODELS.includes(message.model)) throw new Error("模型配置无效。");
      const key = message.key ? validateKey(message.key) : await keyValue();
      if (!key) throw new Error("请先填写 Key。");
      if (message.remember === true) { await chrome.storage.local.set({ apiKey: key }); await chrome.storage.session.remove("apiKey"); }
      else { await chrome.storage.session.set({ apiKey: key }); await chrome.storage.local.remove("apiKey"); }
      await chrome.storage.local.set({ model: message.model }); await chrome.storage.session.remove("lensCache"); return { settings: await settings() };
    }
    case "forgetKey": {
      if (currentJob) throw new Error("请先取消当前分析。");
      await Promise.all([chrome.storage.local.remove("apiKey"), chrome.storage.session.remove(["apiKey", "lensCache"])]); return { settings: await settings() };
    }
    case "analyze": await analyze(message.force === true); return {};
    case "cancel": {
      captureVersion++;
      const oldJob = currentJob; currentJob = null; oldJob?.controller.abort();
      state = { ...state, status: state.article ? "ready" : "idle", progress: "", error: "分析已取消。已发出的请求可能仍由 TypeSafe 处理。", reports: [] }; await publish(); return {};
    }
    case "clear": {
      captureVersion++;
      currentJob?.controller.abort(); currentJob = null; state = { ...EMPTY };
      await chrome.storage.session.remove("lensCache"); await publish(); return {};
    }
    case "newArticle": {
      if (currentJob) throw new Error("请先取消当前分析。");
      captureVersion++; state = { ...EMPTY }; await publish(); return {};
    }
    case "focus": if (typeof message.paragraphId !== "string") throw new Error("段落编号无效。"); await focusParagraph(message.paragraphId); return {};
    default: throw new Error("不支持的操作。");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!trustedSender(sender) || !message || typeof message.type !== "string") return false;
  handle(message).then(result => sendResponse({ ok: true, ...result })).catch(error => sendResponse({ ok: false, error: String(error.message || "操作失败。") }));
  return true;
});
