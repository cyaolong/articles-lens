const sample = '某个城市在政策实施后，公共交通客流增加了。文章因此断言全部增长都由这项政策造成，但未排除季节、票价和就业变化等其他解释。作者引用了调查数字，却没有给出采样时间与来源。';
export const fixtures = [
 {name:'微信正文：保留段落、过滤隐藏内容与表单',url:'https://mp.weixin.qq.com/s/local-fixture',html:`<h1 id="activity-name">本地合成文章</h1><a id="js_name">测试公众号</a><em id="publish_time">2026-10-09</em><div id="js_content"><p>${sample.repeat(3)}</p><p>第二段内容与第一段不同。</p><p style="display:none">HIDDEN_SECRET</p><form><span>FORM_SECRET</span><input value="INPUT_SECRET"></form><div contenteditable="true">EDIT_SECRET</div><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="><a href="https://example.test/source">来源文字</a></div>`,expect:'normal'},
 {name:'微信验证页：停止提取',url:'https://mp.weixin.qq.com/s/local-fixture',html:'<main><h1>环境异常</h1><p>请完成安全验证</p></main>',expect:'blocked'},
 {name:'微信删除页：停止提取',url:'https://mp.weixin.qq.com/s/local-fixture',html:'<main>该内容已被发布者删除</main>',expect:'deleted'},
 {name:'正文尚不可见：停止提取',url:'https://mp.weixin.qq.com/s/local-fixture',html:`<div id="js_content" style="visibility:hidden"><p>${sample.repeat(3)}</p></div>`,expect:'blocked'},
 {name:'父元素隐藏：停止提取',url:'https://mp.weixin.qq.com/s/local-fixture',html:`<div style="display:none"><div id="js_content"><p>${sample.repeat(3)}</p></div></div>`,expect:'blocked'},
 {name:'根元素隐藏：停止提取',url:'https://mp.weixin.qq.com/s/local-fixture',html:`<div id="js_content"><p>${sample.repeat(3)}</p></div>`,expect:'blocked',hideRoot:true},
 {name:'纯图片微信文章：提示补充文字',url:'https://mp.weixin.qq.com/s/local-fixture',html:'<div id="js_content"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="></div>',expect:'image'},
 {name:'正文提到验证：不会误识别为验证页',url:'https://mp.weixin.qq.com/s/local-fixture',html:`<div id="js_content"><p>文章讨论安全验证和验证码的产品设计。${sample.repeat(3)}</p></div>`,expect:'normal'},
 {name:'一般文章：Readability正文过滤页面导航',url:'https://example.test/article',html:`<nav>NAV_SECRET</nav><article><h1>论证样本</h1>${Array.from({length:8},()=>'<p>'+sample+'</p>').join('')}<p style="display:none">HIDDEN_SECRET</p><form>FORM_SECRET</form></article><aside>ASIDE_SECRET</aside>`,expect:'generic'},
 {name:'一般页面：不将整页文本作为降级正文',url:'https://example.test/dashboard',html:'<form><label>账号管理设置</label><input value="INPUT_SECRET"></form><nav>NAV_SECRET</nav>',expect:'blocked'},
 {name:'微信链接移除跟踪参数',url:'https://mp.weixin.qq.com/s?__biz=ABC&mid=1&idx=1&sn=S&token=TRACKING_SECRET#rd',html:`<div id="js_content"><p>${sample.repeat(3)}</p></div>`,expect:'url'}
];
