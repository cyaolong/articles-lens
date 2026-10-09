import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtures} from './fixtures.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function startServer(){
  const extractor=fs.readFileSync(path.join(root,'extractor.js'),'utf8');
  const runner=`const fixtures=${JSON.stringify(fixtures)};const extract=new Function('location',${JSON.stringify('return '+extractor.slice(extractor.indexOf('(() =>')))});const outcomes=[];
  for(const fixture of fixtures){document.documentElement.style.display=fixture.hideRoot?'none':'';document.getElementById('fixture').innerHTML=fixture.html;const result=extract({href:fixture.url});
  let pass=false;if(['normal','generic','url'].includes(fixture.expect)){pass=result.ok&&!/HIDDEN_SECRET|FORM_SECRET|INPUT_SECRET|EDIT_SECRET|NAV_SECRET|ASIDE_SECRET/.test(result.article.text);if(fixture.expect==='url')pass=pass&&!result.article.url.includes('TRACKING_SECRET');}
  else if(fixture.expect==='image')pass=!result.ok&&result.error.includes('图片');else if(fixture.expect==='deleted')pass=!result.ok&&/删除/.test(result.error);else pass=!result.ok;outcomes.push({name:fixture.name,pass});}
  document.documentElement.style.display='';document.getElementById('fixture').innerHTML='';document.getElementById('outcome').textContent=JSON.stringify(outcomes);`;
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/qa/fixtures.js'){res.setHeader('content-type','text/javascript');return res.end(runner);}
    if(pathname==='/qa/fixtures.html'){res.setHeader('content-type','text/html; charset=utf-8');return res.end('<!doctype html><meta charset="utf-8"><div id="fixture"></div><pre id="outcome"></pre><script src="/vendor/Readability.js"></script><script src="/qa/fixtures.js"></script>');}
    const file=path.resolve(root,'.'+pathname),relative=path.relative(root,file);
    if(relative.startsWith('..')||path.isAbsolute(relative)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end('not found');}
    res.setHeader('content-type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
