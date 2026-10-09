import { DIMENSIONS, RISKS, MIN_CONFIDENCE, partitionArticle, riskLabel, exportReport } from './lib/analysis.js';
import { Navigation } from './ui/navigation.js';
const $ = id => document.getElementById(id);
const nav = new Navigation();
let view, config, groupIndex = 0, articleIdentity = '', reportIdentity = '', refreshSerial = 0, pending = false;
const busy = () => pending || ['reading', 'analyzing'].includes(view?.status);
function node(tag, className, text) {
  const el = document.createElement(tag); if (className) el.className = className;
  if (text !== undefined) el.textContent = text; return el;
}
function notice(text, screen = nav.screen) {
  const el = $(screen + '-notice'); el.hidden = !text; el.textContent = text || '';
}
function showPage(reset = false) {
  document.body.dataset.screen = nav.screen;
  for (const screen of ['start', 'result', 'settings']) $(screen + '-page').hidden = screen !== nav.screen;
  $('settings-open').hidden = nav.screen === 'settings';
  if (reset) { $(nav.screen + '-heading').focus({preventScroll:true}); window.scrollTo(0, 0); }
}
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '后台未响应，请重新打开插件。');
  return response;
}
async function action(message) {
  if (pending) return null;
  pending = true; controls();
  try { const response = await send(message); await refresh(); return response; }
  catch (error) { notice(error.message); return null; }
  finally { pending = false; controls(); }
}
function settingsFields() {
  $('key').value = ''; $('remember').checked = config.remember; $('model').value = config.model;
  $('key').placeholder = config.hasKey ? '留空可保留当前 Key' : '填写 Key，无需 Bearer 前缀';
  $('key-status').textContent = config.hasKey ? (config.remember ? '本机已保存' : '已保存，关闭浏览器后清除') : '未填写 Key';
}
function openSettings() {
  if (busy()) return;
  nav.settings(window.scrollY); settingsFields(); notice('', 'settings'); showPage(true);
}
function leaveSettings() {
  $('key').value = ''; notice('', 'settings'); const position = nav.back(); showPage();
  $(nav.screen + '-heading').focus({preventScroll:true}); window.scrollTo(0, position);
}
function controls() {
  if (!view) return;
  const working = ['reading', 'analyzing'].includes(view.status), disabled = busy();
  $('settings-open').disabled = disabled;
  $('analyze').hidden = !view.article || working; $('analyze').disabled = disabled;
  $('cancel').hidden = view.status !== 'analyzing'; $('cancel').disabled = pending;
  for (const id of ['read', 'paste-open', 'paste-submit', 'new-article', 'reanalyze', 'clear-cache']) $(id).disabled = disabled;
  $('paste-title').disabled = disabled; $('paste-text').disabled = disabled;
  $('busy').hidden = !working;
  $('progress').textContent = view.status === 'reading' ? '正在读取正文…' : view.progress;
  $('send-scope').hidden = !view.article || working;
}
function paragraphs(container, article) {
  $(container).replaceChildren(...article.paragraphs.map(p => {
    const li = node('li', 'paragraph'); li.id = container + '-' + p.id;
    li.append(node('span', 'paragraph-id', p.id), document.createTextNode(p.text)); return li;
  }));
}
function renderArticle() {
  const article = view.article; $('empty').hidden = !!article; $('article').hidden = !article;
  if (!article) {
    articleIdentity = ''; $('start-paragraphs').replaceChildren(); $('result-paragraphs').replaceChildren(); return;
  }
  $('article-title').textContent = article.title; $('result-title').textContent = article.title;
  $('source').textContent = {wechat:'网页文章',readability:'网页文章',selection:'选中文字',manual:'粘贴正文'}[article.source] || '文章';
  const groups = partitionArticle(article);
  $('stats').textContent = `${article.text.length.toLocaleString()} 字符${groups.length > 1 ? ` · ${groups.length} 个分析分组` : ''}`;
  $('send-scope').textContent = `点击分析后，标题和正文会发送至 TypeSafe${groups.length > 1 ? `（${groups.length} 个分组）` : ''}。`;
  $('warnings').replaceChildren(...article.warnings.map(w => node('p', '', w)));
  const identity = article.contentHash + article.title + article.source + article.tabId;
  if (identity !== articleIdentity) {
    paragraphs('start-paragraphs', article); paragraphs('result-paragraphs', article);
    $('start-preview').open = false; $('result-preview').open = false;
    articleIdentity = identity; groupIndex = 0; reportIdentity = '';
  }
}
function quote(location) {
  const box = node('div', 'quote');
  if (!location.paragraph) { box.append(node('p','muted','未找到对应段落。')); return box; }
  box.append(node('span','paragraph-id',location.id),node('p','',location.paragraph.text));
  if (location.confidence < MIN_CONFIDENCE) box.append(node('span','low small','位置待核对'));
  const locate = node('button','text-button','查看原文'); locate.type = 'button';
  locate.addEventListener('click', () => {
    $('result-preview').open = true;
    for (const el of $('result-paragraphs').querySelectorAll('.selected')) el.classList.remove('selected');
    const el = $('result-paragraphs-' + location.id);
    if (el) { el.classList.add('selected'); el.scrollIntoView({block:'center',behavior:'smooth'}); }
  }); box.append(locate);
  if (view.article.tabId !== null && location.confidence >= MIN_CONFIDENCE) {
    const source = node('button','text-button','回到网页'); source.type='button';
    source.addEventListener('click', () => action({type:'focus',paragraphId:location.id})); box.append(source);
  }
  return box;
}
function riskCard(risk) {
  const def = RISKS.find(d => d.id === risk.id), card = node('div','risk');
  const heading = node('div','risk-head'); heading.append(node('h4','',def.name),node('span','signal',riskLabel(risk.probability)));
  card.append(heading);
  if (risk.location.paragraph && risk.location.confidence >= MIN_CONFIDENCE) card.append(quote(risk.location));
  else card.append(node('p','muted small','对应段落尚不确定，请对照原文。'));
  const details = node('details','risk-details'); details.append(node('summary','','判断详情'),node('p','muted small',`${def.note} 模型判断概率 ${Math.round(risk.probability*100)}%。`));
  card.append(details); return card;
}
function renderReports(force = false) {
  if (!view.reports?.length) { reportIdentity = ''; return; }
  groupIndex = Math.min(groupIndex, view.reports.length-1);
  const identity = JSON.stringify(view.reports) + view.status + view.cacheHit;
  if (!force && identity === reportIdentity) return;
  reportIdentity = identity;
  const report = view.reports[groupIndex];
  $('partial').hidden = view.status === 'done';
  $('partial').textContent = `仅完成 ${view.reports.length}/${report.total} 组。${view.error || ''}`;
  $('group-wrap').hidden = report.total <= 1;
  $('group').replaceChildren(...view.reports.map((r,i) => {const option = node('option','',`第 ${r.index+1}/${r.total} 组`);option.value=String(i);return option;}));
  $('group').value = String(groupIndex); $('narrative-note').hidden = report.argumentative >= 0.5;
  $('dimensions').replaceChildren(...report.dimensions.map(s => {
    const def = DIMENSIONS.find(d => d.id === s.id), card = node('div','dimension');
    card.append(node('h3','',def.name));
    const score = node('div','value');score.append(document.createTextNode(s.score.toFixed(1)),node('span','score-unit',' / 3'));card.append(score);
    const bar=node('div','bar'),fill=node('div','bar-fill');fill.style.width=`${s.score/3*100}%`;bar.append(fill);card.append(bar);
    if (s.confidence < MIN_CONFIDENCE) card.append(node('span','low small','把握较低'));
    const details=node('details','score-details');details.append(node('summary','','评分说明'),node('p','muted small',`${def.levels[s.level]} · 模型把握 ${Math.round(s.confidence*100)}%`));
    details.append(node('ol','rubric'));
    details.lastChild.append(...def.levels.map((level,i)=>node('li','',`${i} · ${level}`)));card.append(details);return card;
  }));
  const obvious = report.risks.filter(r=>r.probability>=0.8), uncertain=report.risks.filter(r=>r.probability>0.2&&r.probability<0.8);
  $('risks').replaceChildren(...obvious.map(riskCard));
  if (!obvious.length) $('risks').append(node('p','muted',uncertain.length ? '没有明显疑点，另有不确定项。' : 'Jev 未发现明显疑点。'));
  $('uncertain').hidden=!uncertain.length; $('uncertain-title').textContent=`${uncertain.length} 项判断不确定`;
  $('uncertain-risks').replaceChildren(...uncertain.map(riskCard));
  $('main-claim').replaceChildren(node('p','muted small','可能的主张段落'),quote(report.mainClaim));
  $('model-info').textContent=[report.model,view.cacheHit?'使用已保存的结果':''].filter(Boolean).join(' · ');
  $('export').textContent=view.status==='done'?'导出':'导出部分结果';
}
async function refresh() {
  const serial=++refreshSerial, response=await send({type:'getState'});
  if (serial !== refreshSerial) return;
  view=response.state;config=response.settings;
  renderArticle(); renderReports();
  const changed=nav.sync(view);showPage(changed);controls();
  notice(view.status==='error'&&!view.reports.length?view.error:'','start');
}
$('settings-open').addEventListener('click',openSettings);
$('settings-back').addEventListener('click',leaveSettings);
$('read').addEventListener('click',()=>action({type:'read'}));
$('analyze').addEventListener('click',()=>{if(busy())return;if(!config.hasKey){openSettings();return;}action({type:'analyze'});});
$('cancel').addEventListener('click',()=>action({type:'cancel'}));
$('new-article').addEventListener('click',async()=>{if(await action({type:'newArticle'})){$('paste-text').value='';$('paste-title').value='';$('manual').hidden=true;$('paste-open').setAttribute('aria-expanded','false');window.scrollTo(0,0);}});
$('clear-cache').addEventListener('click',()=>action({type:'clear'}));
$('reanalyze').addEventListener('click',()=>{if(!config.hasKey){openSettings();return;}action({type:'analyze',force:true});});
$('group').addEventListener('change',e=>{groupIndex=Number(e.target.value);renderReports(true);});
$('paste-open').addEventListener('click',()=>{$('manual').hidden=!$('manual').hidden;$('paste-open').setAttribute('aria-expanded',String(!$('manual').hidden));if(!$('manual').hidden)$('paste-text').focus();});
$('manual').addEventListener('submit',async e=>{
  e.preventDefault();if(await action({type:'paste',title:$('paste-title').value,text:$('paste-text').value})){$('manual').hidden=true;$('paste-open').setAttribute('aria-expanded','false');$('paste-title').value='';$('paste-text').value='';}
});
$('key-form').addEventListener('submit',async e=>{
  e.preventDefault();if(await action({type:'saveKey',key:$('key').value.trim(),remember:$('remember').checked,model:$('model').value}))leaveSettings();
});
$('forget').addEventListener('click',async()=>{if(await action({type:'forgetKey'})){settingsFields();notice('Key 已移除。','settings');}});
$('export').addEventListener('click',()=>{
  if(!view.article||!view.reports.length)return;
  let text=exportReport(view.article,view.reports,view.createdAt||new Date().toISOString());
  if(view.status!=='done')text=`仅完成 ${view.reports.length}/${view.reports[0].total} 组，以下为部分结果。\n\n`+text;
  const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=(view.article.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,70)||'文章')+'-论证分析.md';
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
});
chrome.runtime.onMessage.addListener((message,sender)=>{if(sender.id===chrome.runtime.id&&message?.type==='lensUpdated')refresh().catch(e=>notice(e.message));});
refresh().catch(e=>notice(e.message,'start'));
