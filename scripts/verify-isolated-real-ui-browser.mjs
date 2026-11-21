import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const server=spawn(process.execPath,['./node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4189','--strictPort'],{stdio:'pipe'});
let browser;
try{
 let ready=false;
 for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error('vite-exited');try{const r=await fetch('http://127.0.0.1:4189/isolated-real-ui.html');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,250))}
 assert.ok(ready,'vite-startup');
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4189/isolated-real-ui.html');
 await page.getByText('MOVIE MENTOR',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Send'}).waitFor();
 console.log('GREEN REAL_PINNED_UI_BROWSER_RENDERED');
 const send=page.getByRole('button',{name:'Send'});
 assert.equal(await send.isDisabled(),true);
 const input=page.getByPlaceholder("Tell Movie Mentor what's on your mind...");
 await input.fill('isolated browser typing');
 assert.equal(await send.isEnabled(),true);
 assert.equal(await input.inputValue(),'isolated browser typing');
 assert.deepEqual(errors,[]);
 console.log('GREEN REAL_PINNED_UI_BROWSER_COMPOSER_INPUT');
 await page.reload();
 await page.getByText('MOVIE MENTOR',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Send'}).isDisabled(),true);
 assert.equal(await page.getByPlaceholder("Tell Movie Mentor what's on your mind...").inputValue(),'');
 assert.deepEqual(errors,[]);
 console.log('GREEN REAL_PINNED_UI_BROWSER_RELOAD_NO_UNVERIFIED_DRAFT_ADOPTION');
 console.log('HELD REAL_BROWSER_SERVER_AUTHORITY_SAVE_RELOAD_AND_ORIGINAL_FRONTEND_RED');
}finally{await browser?.close();server.kill('SIGTERM')}
