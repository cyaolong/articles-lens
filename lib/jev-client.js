import { ENDPOINT } from "./analysis.js";

export function validateKey(key) {
  if (typeof key !== "string" || !/^[\x21-\x7e]{8,512}$/.test(key.trim()) || /^Bearer\s/i.test(key.trim())) throw new Error("请填写 API Key 本身，不要加 Bearer 前缀或空格。");
  return key.trim();
}

export async function callJev(payload, key, { signal, onRetry = () => {}, fetchImpl = fetch, timeoutMs = 24000 } = {}) {
  key = validateKey(key);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new Error("分析已取消。");
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: controller.signal
      });
      if ((response.status === 429 || response.status === 529) && attempt === 0) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Math.min(2000, Math.max(750, Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000));
        onRetry(response.status);
        await new Promise(resolve => { const t = setTimeout(resolve, delay); controller.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true }); });
        if (controller.signal.aborted) throw new Error(signal?.aborted ? "分析已取消。" : "请求超时，请重试。");
        continue;
      }
      if (!response.ok) {
        const messages = { 401: "Key 无效或已撤销，请在设置中重新配置。", 403: "TypeSafe 拒绝了当前 Key 的访问，请检查账户权限。", 422: "TypeSafe 无法处理该请求，可能超出上下文限制。请分批粘贴正文后重试。", 429: "请求达到 TypeSafe 限流，请稍后再试。", 529: "TypeSafe 当前繁忙，请稍后再试。" };
        throw new Error(messages[response.status] || `TypeSafe 返回 HTTP ${response.status}，未展示分析结果。`);
      }
      const raw = await response.text();
      if (raw.length > 1000000) throw new Error("响应超过安全大小限制。");
      try { return JSON.parse(raw); } catch (_) { throw new Error("TypeSafe 返回的内容不是有效 JSON。"); }
    } catch (error) {
      if (signal?.aborted) throw new Error("分析已取消。");
      if (timedOut) throw new Error("TypeSafe 请求超过 24 秒，已停止。请稍后重试；插件不会自动重复可能已计费的请求。");
      if (error instanceof TypeError || error.name === "AbortError") throw new Error("无法连接 TypeSafe。请检查网络或 VPN 后重试。");
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
}
