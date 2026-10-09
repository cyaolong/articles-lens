import test from "node:test";
import assert from "node:assert/strict";
import { callJev, validateKey } from "../lib/jev-client.js";

test("Key 校验拒绝前缀、换行与非字符串", () => {
  for (const key of ["Bearer synthetic", "1234", "test\nsecret", {}, "中文秘密测试"]) assert.throws(() => validateKey(key));
  assert.equal(validateKey(" synthetic-test-key "), "synthetic-test-key");
});
test("网络只发送到固定HTTPS端点，凭证只在Authorization", async () => {
  const result = await callJev({ state: "text" }, "synthetic-test-key", { fetchImpl: async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(options.headers.Authorization, "Bearer synthetic-test-key");
    assert.ok(!options.body.includes("synthetic-test-key"));
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
    return new Response('{"ok":true}');
  } });
  assert.deepEqual(result, { ok: true });
});
test("错误响应不回显服务端正文或凭证", async () => {
  for (const status of [401, 403, 422, 500]) {
    await assert.rejects(() => callJev({}, "synthetic-test-key", { fetchImpl: async () => new Response("secret-data <script>", { status }) }), error => !error.message.includes("secret-data") && !error.message.includes("script"));
  }
});
test("限流最多重试一次，正常请求与500不会自动重复", async () => {
  let calls = 0;
  await assert.rejects(() => callJev({}, "synthetic-test-key", { fetchImpl: async () => { calls++; return new Response("", { status: 429, headers: { "retry-after": "0" } }); } }), /限流/);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(() => callJev({}, "synthetic-test-key", { fetchImpl: async () => { calls++; return new Response("", { status: 500 }); } }));
  assert.equal(calls, 1);
});
test("超时与主动取消停止挂起请求", async () => {
  const hanging = async (_, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  await assert.rejects(() => callJev({}, "synthetic-test-key", { fetchImpl: hanging, timeoutMs: 20 }), /24 秒/);
  const abort = new AbortController();
  const task = callJev({}, "synthetic-test-key", { fetchImpl: hanging, signal: abort.signal });
  abort.abort(); await assert.rejects(() => task, /取消/);
});
test("无效JSON与过大响应按失败处理", async () => {
  await assert.rejects(() => callJev({}, "synthetic-test-key", { fetchImpl: async () => new Response("not-json") }), /有效 JSON/);
  await assert.rejects(() => callJev({}, "synthetic-test-key", { fetchImpl: async () => new Response("x".repeat(1000001)) }), /大小/);
});
