import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
const worker='./verify-isolated-conversation-sigkill-worker.mjs';
function run(phase){const r=spawnSync(process.execPath,[worker,phase],{encoding:'utf8',env:process.env,timeout:30000});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');assert.equal(r.status,0,phase+' failed '+r.error?.message)}
async function killAt(phase,marker){await new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[worker,phase],{env:process.env,stdio:['ignore','pipe','pipe']});
 let output='',done=false;const timeout=setTimeout(()=>finish(new Error('timeout waiting for '+marker)),25000);
 function finish(error){if(done)return;done=true;clearTimeout(timeout);child.kill('SIGKILL');error?reject(error):resolve()}
 child.stdout.on('data',chunk=>{const text=chunk.toString();output+=text;process.stdout.write(text);if(output.includes(marker))finish()});
 child.stderr.on('data',chunk=>process.stderr.write(chunk));
 child.on('error',finish);child.on('exit',(code,signal)=>{if(!done)finish(new Error('worker exited before marker '+code+' '+signal))});
});}
run('seed');await killAt('before-commit','READY_TO_KILL_BEFORE_COMMIT');run('verify-rollback');
run('seed');await killAt('after-commit','READY_TO_KILL_AFTER_COMMIT');run('recover');
console.log('HELD REAL_STUDIO_UI_INTEGRATION_AND_ORIGINAL_FRONTEND_RED');
