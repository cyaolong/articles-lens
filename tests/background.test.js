import test from "node:test";
import assert from "node:assert/strict";
import { makeChrome, responseFor } from "./helpers.js";

test("MV3 后台的权限、消息、凭证、缓存和取消流程", async t => {
  const syntheticText = "这是一篇本地测试文章，不是用户提供的微信文章。文中认为销量随时间上升，因此所有增长都由某项政策造成；我们需要检查替代解释和数字来源。".repeat(10);
  const env = makeChrome({ extraction: { ok: true, article: { text: syntheticText, title: "合成文章", source: "wechat", url: "https://example.test/article" } } });
  globalThis.chrome = env.chrome;
  let fetchCount = 0;
  globalThis.fetch = async (_, options) => { fetchCount++; return new Response(JSON.stringify(responseFor(JSON.parse(options.body)))); };
  await import("../background.js");
  const get = async () => (await env.message({ type: "getState" })).state;
  async function waitDone() {
    for (let i = 0; i < 100; i++) { const state = await get(); if (state.status !== "analyzing") return state; await new Promise(resolve => setTimeout(resolve, 5)); }
    throw new Error("任务没有完成");
  }
  await t.test("存储限制为可信扩展上下文", async () => {
    await get(); assert.deepEqual(env.accessLevels, [["local", "TRUSTED_CONTEXTS"], ["session", "TRUSTED_CONTEXTS"]]);
  });
  await t.test("网页内容脚本、伪造ID与其他扩展页面不能驱动后台", async () => {
    for (const sender of [{ id: "test-extension", url: "https://example.test/", tab: { id: 9 } }, { id: "attacker", url: env.chrome.runtime.getURL("panel.html") }, { id: "test-extension", url: env.chrome.runtime.getURL("attacker.html") }]) {
      assert.equal(await env.message({ type: "analyze" }, sender), undefined);
    }
    assert.equal(fetchCount, 0);
  });
  await t.test("扩展面板在标签页中打开时也可初始化，不能用tab字段判断可信来源", async () => {
    const result = await env.message({ type: "getState" }, { id: "test-extension", url: env.chrome.runtime.getURL("panel.html"), tab: { id: 5 } });
    assert.equal(result.ok, true); assert.equal(result.settings.hasKey, false);
  });
  await t.test("仅本地读取，不访问网络且采集脚本不携带Key", async () => {
    await env.message({ type: "read" }); const state = await get();
    assert.equal(state.status, "ready"); assert.equal(fetchCount, 0);
    assert.equal(env.injections[0].world, "ISOLATED"); assert.ok(!JSON.stringify(env.injections).includes("apiKey"));
  });
  await t.test("无Key拒绝分析，默认Key仅保存当前会话且不返回原值", async () => {
    assert.equal((await env.message({ type: "analyze" })).ok, false);
    await env.message({ type: "saveKey", key: "synthetic-test-key", remember: false, model: "jev-1.13.0" });
    assert.equal(env.session.apiKey, "synthetic-test-key"); assert.ok(!env.local.apiKey);
    const visible = await env.message({ type: "getState" });
    assert.ok(!JSON.stringify(visible).includes("synthetic-test-key"));
  });
  await t.test("正常分析、重复命中缓存与明确重新请求", async () => {
    await env.message({ type: "analyze" }); assert.equal((await waitDone()).status, "done");
    assert.equal(fetchCount, 1);
    await env.message({ type: "analyze" }); assert.equal((await get()).cacheHit, true); assert.equal(fetchCount, 1);
    await env.message({ type: "analyze", force: true }); await waitDone(); assert.equal(fetchCount, 2);
  });
  await t.test("并发点击不会产生重复计费请求，取消后不覆盖新状态", async () => {
    let release;
    globalThis.fetch = async (_, options) => new Promise(resolve => { fetchCount++; release = () => resolve(new Response(JSON.stringify(responseFor(JSON.parse(options.body))))); });
    const responses = await Promise.all([env.message({ type: "analyze", force: true }), env.message({ type: "analyze", force: true })]);
    assert.equal(responses.filter(r => r.ok).length, 1);
    await env.message({ type: "cancel" });
    await env.message({ type: "paste", title: "新的粘贴文章", text: syntheticText + "不同内容" });
    release(); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await get()).article.title, "新的粘贴文章"); assert.equal((await get()).status, "ready");
  });
  await t.test("本机记住与切回会话存储会移除旧位置，移除Key清缓存", async () => {
    await env.message({ type: "saveKey", key: "synthetic-test-key", remember: true, model: "jev-1.13.0" });
    assert.ok(env.local.apiKey); assert.ok(!env.session.apiKey);
    await env.message({ type: "saveKey", key: "", remember: false, model: "jev-latest" });
    assert.ok(!env.local.apiKey); assert.ok(env.session.apiKey);
    await env.message({ type: "forgetKey" }); assert.ok(!env.local.apiKey && !env.session.apiKey && !env.session.lensCache);
  });
  await t.test("清除正文与缓存保留模型偏好", async () => {
    await env.message({ type: "clear" }); assert.equal((await get()).article, null); assert.equal(env.local.model, "jev-latest");
  });
});
