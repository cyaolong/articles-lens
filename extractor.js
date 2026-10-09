// Injected only after the user clicks. No storage, credentials or network access.
(() => {
  const clean = s => String(s || "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/[\t \u00a0]+/g, " ").trim();
  const textOf = selector => clean(document.querySelector(selector)?.innerText);
  const visibleCache = new WeakMap();
  const visible = el => {
    if (!el) return true;
    if (visibleCache.has(el)) return visibleCache.get(el);
    const style = getComputedStyle(el);
    const ok = !el.hidden && el.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && visible(el.parentElement);
    visibleCache.set(el, ok); return ok;
  };
  const excluded = el => ["SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "FORM", "NAV", "ASIDE", "IFRAME", "SVG"].includes(el.tagName) || el.isContentEditable || el.matches('[contenteditable="true"], [contenteditable=""], [role="textbox"], #js_bottom_ad_area, #js_top_ad_area, .js_ad_link, .article-lens-highlight');
  const blocks = new Set(["P", "DIV", "SECTION", "ARTICLE", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "TR", "FIGCAPTION"]);
  function read(root) {
    let out = "";
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) { out += node.nodeValue; return; }
      if (node.nodeType !== Node.ELEMENT_NODE || excluded(node) || !visible(node)) return;
      if (node.tagName === "BR") { out += "\n"; return; }
      if (node.tagName === "TD" || node.tagName === "TH") out += " ";
      if (blocks.has(node.tagName)) out += "\n";
      for (const child of node.childNodes) visit(child);
      if (blocks.has(node.tagName)) out += "\n";
    }
    visit(root);
    return out.split(/\r?\n/).map(clean).filter(Boolean).join("\n");
  }
  const selection = clean(window.getSelection()?.toString());
  const url = new URL(location.href);
  const wechat = url.hostname === "mp.weixin.qq.com";
  let root, title, author = "", publishedAt = "", source, bodyText, media = null;
  if (wechat) {
    root = document.querySelector("#js_content");
    if (!root || !visible(root)) {
      const pageText = clean(document.body?.innerText).slice(0, 4000);
      let error = "未找到已加载且可见的微信正文。请先在 Chrome 中打开文章并完成必要验证，再点击插件；也可手动粘贴正文。";
      if (/环境异常|访问过于频繁|完成.*验证|安全验证|验证码/.test(pageText)) error = "当前是微信验证或访问受限页，插件没有读取文章。请在原网页自行完成验证后重试，或粘贴你能正常阅读的正文。";
      else if (/已被删除|内容已删除|该内容已被发布者删除|无法查看|此内容因违规|链接已过期/.test(pageText)) error = "微信页面提示内容删除、过期或不可查看。插件无法恢复正文，请使用你已有的文章文本。";
      return { ok: false, error };
    }
    title = textOf("#activity-name") || textOf(".rich_media_title") || clean(document.title);
    author = textOf("#js_name"); publishedAt = textOf("#publish_time");
    source = "wechat"; bodyText = read(root);
    // Selection is deliberately not an automatic fallback: preview covers the article.
  } else {
    source = "readability";
    const clone = document.cloneNode(true);
    const originals = Array.from(document.querySelectorAll("*"));
    const copied = Array.from(clone.querySelectorAll("*"));
    for (let i = originals.length - 1; i >= 0; i--) {
      if (copied[i] && (excluded(originals[i]) || !visible(originals[i]))) copied[i].remove();
    }
    function inertRead(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      if (node.nodeType !== Node.ELEMENT_NODE || excluded(node)) return "";
      if (node.tagName === "BR") return "\n";
      const t = Array.from(node.childNodes).map(inertRead).join("");
      return blocks.has(node.tagName) ? "\n" + t + "\n" : t;
    }
    let parsed;
    try {
      parsed = new Readability(clone, { maxElemsToParse: 20000, serializer: node => ({
        text: inertRead(node), imageCount: node.querySelectorAll("img").length,
        videoCount: node.querySelectorAll("video, iframe").length,
        linkCount: Array.from(node.querySelectorAll("a[href]")).filter(a => /^https?:/i.test(a.getAttribute("href") || "")).length
      }) }).parse();
    } catch (_) { /* fail closed */ }
    if (parsed?.content?.text) {
      media = parsed.content;
      bodyText = media.text.split(/\r?\n/).map(clean).filter(Boolean).join("\n");
      title = clean(parsed.title) || clean(document.title); author = clean(parsed.byline);
    }
    if (!bodyText || bodyText.length < 80) {
      if (selection.length >= 80) { bodyText = selection; source = "selection"; root = null; title = clean(document.title); }
      else return { ok: false, error: "没有提取到明确正文。请选中需要分析的文字后重新点击插件，或在侧边栏粘贴正文。插件不会上传整页文本。" };
    }
  }
  const imageCount = root ? Array.from(root.querySelectorAll("img")).filter(visible).length : media?.imageCount || 0;
  const videoCount = root ? root.querySelectorAll("video, iframe").length : media?.videoCount || 0;
  const linkCount = root ? Array.from(root.querySelectorAll("a[href]")).filter(a => /^https?:/i.test(a.getAttribute("href") || "")).length : media?.linkCount || 0;
  if (bodyText.length < 80) return { ok: false, error: imageCount ? "文章主要由图片构成，未提取到足够文字。Jev 只支持文本；请将图片中的正文转成文字后粘贴。" : "已找到正文区域，但可见文字不足 80 个字符。请等待正文加载完成，或手动粘贴。" };
  const warnings = [];
  if (imageCount) warnings.push(`正文含 ${imageCount} 张图片：图片内的文字、图表和证据没有分析。`);
  if (videoCount) warnings.push(`正文含 ${videoCount} 个视频或嵌入内容：其内容没有分析。`);
  if (linkCount) warnings.push(`正文含 ${linkCount} 个链接：插件没有打开或核查外部来源。`);
  if (source === "selection") warnings.push("本次只分析你选中的文字，不代表全文。");
  url.hash = "";
  if (wechat) {
    for (const key of Array.from(url.searchParams.keys())) if (!["__biz", "mid", "idx", "sn"].includes(key)) url.searchParams.delete(key);
  } else url.search = "";
  return { ok: true, article: { title, author, publishedAt, source, url: url.href, text: bodyText, imageCount, videoCount, linkCount, warnings } };
})();
