import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {startServer} from './server.mjs';
import {responseFor} from '../helpers.js';
const root=fileURLToPath(new URL('../../',import.meta.url)), artifacts=path.join(root,'test-results');
await fs.mkdir(artifacts,{recursive:true});
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'article-lens-qa-'));
const server=await startServer(),checks=[];
let context;
try{
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:380,height:950},ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--host-resolver-rules=MAP api.typesafe.ai ~NOTFOUND']});
 let apiCalls=0,mode='normal',groupCalls=0,release;
 await context.route('https://api.typesafe.ai/**',async route=>{
   apiCalls++;const request=route.request(),payload=request.postDataJSON();
   assert.equal(request.url(),'https://api.typesafe.ai/v1/systemone');assert.ok(!JSON.stringify(payload).includes('synthetic-test-key'));
   if(mode==='hold')await new Promise(resolve=>{release=resolve;});
   if(mode==='unauthorized'||(mode==='partial'&&++groupCalls===2)){await route.fulfill({status:mode==='unauthorized'?401:500,body:'service error'});return;}
   const response=responseFor(payload);response.answers.evidence.score=1;response.answers.logic.confidence=.59;response.answers.generalization.noul=.55;
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
 });
 const fixturePage=await context.newPage();await fixturePage.goto(server.url+'/qa/fixtures.html');
 await fixturePage.waitForFunction(()=>document.getElementById('outcome').textContent.length>0);
 const extractionChecks=JSON.parse(await fixturePage.locator('#outcome').textContent());assert.ok(extractionChecks.every(x=>x.pass));await fixturePage.close();
 const source=await context.newPage();await source.goto(server.url+'/tests/fixtures/article.html');
 const cdp=await context.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:root});
 let worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'+id));if(!worker)worker=await context.waitForEvent('serviceworker');
 const errors=[];worker.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 let panel=await context.newPage();panel.on('pageerror',e=>errors.push(e.message));
 const open=async()=>{await panel.goto('chrome-extension://'+id+'/panel.html');await panel.waitForFunction(()=>document.body.dataset.screen);};
 const state=async()=>worker.evaluate(async()=>(await chrome.storage.session.get('lensState')).lensState);
 const screen=async name=>panel.waitForFunction(expected=>document.body.dataset.screen===expected,name);
 const check=name=>{checks.push({check:name,pass:true});console.log(name);};
 const toolbar=async()=>{
   await source.bringToFront();const {targetInfos}=await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
   const target=targetInfos.find(t=>t.type==='tab'&&t.url===source.url());await cdp.send('Extensions.triggerAction',{id,targetId:target.targetId});
   await panel.locator('#article-title').waitFor();await screen('start');
 };
 const newArticle=async()=>{await panel.getByRole('button',{name:'分析另一篇',exact:true}).click();await screen('start');};
 const paste=async(title,text)=>{await panel.getByRole('button',{name:'粘贴正文',exact:true}).click();await panel.getByLabel('标题（可选）').fill(title);await panel.getByLabel('正文',{exact:true}).fill(text);await panel.getByRole('button',{name:'导入正文',exact:true}).click();await panel.locator('#article-title').waitFor();};
 await open();assert.equal(await panel.locator('#result-page').isVisible(),false);assert.equal(await panel.locator('#settings-page').isVisible(),false);check('初始仅显示开始页');
 await toolbar();assert.equal(apiCalls,0);assert.ok(!/HIDDEN_SECRET|FORM_SECRET|INPUT_SECRET/.test((await state()).article.text));check('工具栏自动采集，不调用模型且过滤隐藏内容');
 await panel.screenshot({path:path.join(artifacts,'start.png')});
 await panel.getByRole('button',{name:'开始分析',exact:true}).click();await screen('settings');check('缺Key跳转独立设置页');
 await panel.getByLabel('TypeSafe / Jev API Key',{exact:true}).fill('unsaved-dummy-key');await panel.getByRole('button',{name:'← 返回',exact:true}).click();await screen('start');
 await panel.getByRole('button',{name:'设置',exact:true}).click();assert.equal(await panel.locator('#key').inputValue(),'');check('设置返回保留文章，清空未保存Key');
 await panel.getByLabel('TypeSafe / Jev API Key',{exact:true}).fill('synthetic-test-key');await panel.getByRole('button',{name:'保存并返回',exact:true}).click();await screen('start');assert.equal(apiCalls,0);check('保存并返回不发API');
 await panel.getByRole('button',{name:'开始分析',exact:true}).click();await screen('result');assert.equal(apiCalls,1);assert.equal(await panel.locator('.dimension').count(),6);assert.equal(await panel.locator('#overall').count(),0);assert.equal(await panel.locator('#uncertain').isVisible(),true);assert.equal(await panel.locator('#uncertain').evaluate(e=>e.open),false);check('自动进入结果页，六项评分平级，保留不确定项');
 assert.equal(await panel.getByRole('button',{name:'分析另一篇',exact:true}).evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),true);await panel.screenshot({path:path.join(artifacts,'results.png')});
 await panel.getByRole('button',{name:'设置',exact:true}).click();await screen('settings');await panel.screenshot({path:path.join(artifacts,'settings.png')});
 await panel.getByLabel('TypeSafe / Jev API Key',{exact:true}).fill('discard-dummy-key');await panel.getByRole('button',{name:'← 返回',exact:true}).click();await screen('result');assert.equal(await panel.locator('.dimension').count(),6);check('结果页设置往返保留结果');
 const downloaded=panel.waitForEvent('download');await panel.getByRole('button',{name:'导出',exact:true}).click();const report=await fs.readFile(await(await downloaded).path(),'utf8');assert.ok(report.includes('不核查事实真伪'));assert.ok(!report.includes('synthetic-test-key'));check('实际Markdown下载不包含Key');
 await panel.getByRole('button',{name:'查看原文',exact:true}).first().click();assert.equal(await panel.locator('.paragraph.selected').count(),1);
 await panel.getByRole('button',{name:'回到网页',exact:true}).first().click();const current=await state();await source.waitForFunction(quote=>document.getAnimations().some(a=>a.effect?.target?.innerText?.includes(quote)),current.reports[0].risks.find(r=>r.id==='causality').location.paragraph.text);check('原文预览定位及真实源页高亮');
 await panel.reload();await screen('result');check('关闭或重新打开面板恢复结果');
 await newArticle();assert.equal((await state()).article,null);await toolbar();await panel.getByRole('button',{name:'开始分析',exact:true}).click();await screen('result');assert.equal(apiCalls,1);check('分析另一篇保留Key和缓存，再分析命中缓存');
 mode='unauthorized';await panel.locator('#analysis-details').evaluate(e=>e.open=true);await panel.getByRole('button',{name:'重新分析（会消耗用量）',exact:true}).click();await screen('start');await panel.getByText(/Key 无效/).waitFor();assert.ok((await state()).article);check('鉴权失败保留输入并显示可操作提示');mode='normal';
 // Draft text remains intact across settings navigation before import.
 await panel.getByRole('button',{name:'粘贴正文',exact:true}).click();await panel.getByLabel('正文',{exact:true}).fill('尚未导入的草稿');await panel.getByRole('button',{name:'设置',exact:true}).click();await panel.getByRole('button',{name:'← 返回',exact:true}).click();assert.equal(await panel.getByLabel('正文',{exact:true}).inputValue(),'尚未导入的草稿');await panel.getByRole('button',{name:'粘贴正文',exact:true}).click();check('设置往返保留粘贴草稿');
 await panel.getByRole('button',{name:'开始分析',exact:true}).click();await screen('result');mode='hold';await panel.locator('#analysis-details').evaluate(e=>e.open=true);await panel.getByRole('button',{name:'重新分析（会消耗用量）',exact:true}).click();await panel.getByRole('button',{name:'取消分析',exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'设置',exact:true}).isEnabled(),false);
 await toolbar();assert.equal((await state()).status,'analyzing');await panel.getByRole('button',{name:'取消分析',exact:true}).click();await screen('start');const text='取消后导入的文章，用于确认旧请求无法覆盖新任务。'.repeat(10);await paste('取消后的新文章',text);if(release)release();mode='normal';await panel.waitForTimeout(100);assert.equal((await state()).article.title,'取消后的新文章');check('分析中不重复采集，取消后旧请求不能覆盖新输入');
 await panel.getByRole('button',{name:'开始分析',exact:true}).click();await screen('result');
 const languages=[['中文','本文讨论政策效果，需要证据支持并排除其他解释。'.repeat(8)],['English','The policy may correlate with growth, but evidence should distinguish causation from correlation. '.repeat(5)],['日本語','この記事では政策と成長の関係を検討します。結論には根拠と適用範囲の説明が必要です。'.repeat(6)],['混合','中文观点。English evidence. 日本語の説明。'.repeat(8)]];
 for(const [title,body] of languages){await newArticle();await paste(title,body);assert.equal((await state()).article.text,body.trim());await panel.getByRole('button',{name:'开始分析',exact:true}).click();await screen('result');assert.equal(await panel.locator('.dimension').count(),6);}
 check('中英日及混合原文完成同一分析链路');
 await newArticle();await paste('长标题'.repeat(66),'长文会完整分组，已经完成的分组不能被当作全文结果。'.repeat(1000));mode='partial';groupCalls=0;await panel.getByRole('button',{name:'开始分析',exact:true}).click();await screen('result');await panel.getByText(/仅完成 1\//).waitFor();assert.equal((await state()).reports.length,1);await panel.getByRole('button',{name:'导出部分结果',exact:true}).waitFor();check('长文部分失败进入结果页并明确标记范围');
 for(const width of [300,380,600]){await panel.setViewportSize({width,height:950});assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);}check('300/380/600px及长标题无横向溢出');
 await newArticle();const other=await context.newPage();await other.goto(server.url.replace('127.0.0.1','localhost')+'/tests/fixtures/article.html');await other.bringToFront();await panel.evaluate(()=>document.getElementById('read').click());await panel.getByText(/尚未授权读取此页|该页面不能读取/).waitFor();check('未授权新域名拒绝读取');
 await source.goto('chrome://version');await source.bringToFront();const restrictedTargets=await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});await cdp.send('Extensions.triggerAction',{id,targetId:restrictedTargets.targetInfos.find(t=>t.url==='chrome://version/').targetId});await screen('start');await panel.getByText(/该页面不能读取/).waitFor();assert.equal((await state()).status,'error');assert.equal((await state()).article,null);check('不可读取页面不会保留并误展示旧文章结果');
 assert.equal(errors.length,0);await fs.writeFile(path.join(artifacts,'browser-checks.json'),JSON.stringify({browser:context.browser().version(),version:'1.1.0',mockedAPI:true,extractionChecks,checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,extractionPassed:extractionChecks.length,apiCalls},null,2));
}finally{if(context)await context.close();await server.close();await fs.rm(profile,{recursive:true,force:true});}
