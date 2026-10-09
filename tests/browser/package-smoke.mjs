import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const version=JSON.parse(await fs.readFile(path.join(root,'manifest.json'))).version;
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'article-lens-package-'));
const extension=path.join(temporary,'unpacked'),profile=path.join(temporary,'profile');
const archive=path.join(root,`dist/articles-lens-v${version}.zip`);
execFileSync('python3',['-c','import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,extension]);
let context;
try{
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--host-resolver-rules=MAP api.typesafe.ai ~NOTFOUND']});
 const cdp=await context.browser().newBrowserCDPSession();const {id}=await cdp.send('Extensions.loadUnpacked',{path:extension});
 const panel=await context.newPage(),errors=[];panel.on('pageerror',e=>errors.push(e.message));
 await panel.goto(`chrome-extension://${id}/panel.html`);await panel.waitForFunction(()=>document.body.dataset.screen==='start');
 await panel.getByRole('button',{name:'设置',exact:true}).click();await panel.getByLabel('TypeSafe / Jev API Key',{exact:true}).waitFor();assert.equal(errors.length,0);
 const record={version,rootManifest:true,chromeLoadPassed:true,settingsInitialized:true,sha256:createHash('sha256').update(await fs.readFile(archive)).digest('hex'),errors};
 await fs.mkdir(path.join(root,'test-results'),{recursive:true});await fs.writeFile(path.join(root,'test-results/package-check.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));
}finally{if(context)await context.close();await fs.rm(temporary,{recursive:true,force:true});}
