import test from "node:test";
import assert from "node:assert/strict";
import { articleFromText, partitionArticle, buildRequest, parseResponse, exportReport, STATE_BYTE_BUDGET } from "../lib/analysis.js";
import { responseFor } from "./helpers.js";

const sample = "文章声称某政策推出后销量上升，所以全部增长都由该政策造成；这种论证需要排除其他解释。".repeat(5);
test("正文归一化不丢失重复段落，长段落分割不截断", () => {
  const text = ("甲乙丙丁".repeat(2000)) + "\n重复段落\n重复段落";
  const article = articleFromText(text);
  assert.equal(article.paragraphs.map(p => p.text).join(""), text.replaceAll("\n", ""));
  assert.equal(article.paragraphs.at(-1).text, "重复段落");
  assert.equal(article.paragraphs.at(-2).text, "重复段落");
});
test("拒绝空白短文及超过硬限额的正文", () => {
  assert.throws(() => articleFromText("短文"), /不足/);
  assert.throws(() => articleFromText("文".repeat(120001)), /不会静默截断/);
});
test("长篇中文按预算完整分组，每个 Choice 少于255选项", () => {
  const article = articleFromText("中文文章内容。".repeat(14000), { title: "长文" });
  const groups = partitionArticle(article);
  assert.ok(groups.length > 1);
  assert.equal(groups.flatMap(g => g.paragraphs).map(p => p.text).join(""), article.text);
  for (const g of groups) {
    assert.ok(new TextEncoder().encode(JSON.stringify(g.state)).length <= STATE_BYTE_BUDGET);
    const request = buildRequest(g);
    for (const q of Object.values(request.questions)) {
      assert.ok(!("options" in q));
      if (q.type === "choice") assert.ok(Object.keys(q.criteria).length <= 181);
      assert.ok(new TextEncoder().encode(JSON.stringify(request.state) + JSON.stringify(q)).length < 32000);
    }
    assert.ok(new TextEncoder().encode(JSON.stringify(request)).length < 64000);
    assert.match(request.questions.argument.instructions, /excerpt/);
  }
});
test("请求只包含标题和编号正文，不包含URL、Key、Cookie或HTML", () => {
  const article = articleFromText(sample, { title: "样本", url: "https://example.test/private?token=SECRET", author: "作者", tabId: 9 });
  const request = buildRequest(partitionArticle(article)[0]);
  const raw = JSON.stringify(request);
  assert.ok(!raw.includes("SECRET")); assert.ok(!raw.includes("tabId")); assert.ok(!raw.includes("作者"));
  assert.deepEqual(Object.keys(request.state), ["title", "paragraphs"]);
  assert.equal(Object.keys(request.questions).length, 16);
});
test("正常 Score/Noul/Choice 原子响应解析，并导出真实原文", () => {
  const article = articleFromText(sample, { title: "<script>alert(1)</script>" });
  const group = partitionArticle(article)[0], payload = buildRequest(group);
  const report = parseResponse(responseFor(payload), group);
  assert.equal(report.risks.find(r => r.id === "causality").probability, 0.92);
  assert.equal(report.mainClaim.paragraph.text, group.paragraphs[0].text);
  const exported = exportReport(article, [report], "2026-10-09T00:00:00Z");
  assert.ok(exported.includes(sample)); assert.match(exported, /不核查事实真伪/);
  assert.ok(!exported.includes("<script>"));
});
test("缺失字段、越界分数、错误类型和无效定位全部拒绝", () => {
  const group = partitionArticle(articleFromText(sample))[0], request = buildRequest(group);
  for (const modify of [
    r => { delete r.answers.evidence; },
    r => { r.answers.argument.score = 3.2; },
    r => { r.answers.argument.score = NaN; },
    r => { r.answers.argument.confidence = 1.1; },
    r => { r.answers.causality.noul = -0.1; },
    r => { r.answers.main_claim.choice = "P9999"; },
    r => { r.answers.main_claim.confidence = Infinity; },
    r => { r.answers.logic.type = "choice"; }
  ]) {
    const response = responseFor(request); modify(response);
    assert.throws(() => parseResponse(response, group));
  }
});
