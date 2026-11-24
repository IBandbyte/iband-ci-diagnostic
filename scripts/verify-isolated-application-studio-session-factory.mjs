import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApplicationStudioSessionFactory} from './isolated-application-studio-session-factory.mjs';
const app=readFileSync('./frontend/src/App.jsx','utf8');
const regression=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
assert.match(regression,/assert\.equal\(cleared\.acquired, true\)/);
assert.throws(()=>createApplicationStudioSessionFactory(),/dependencies-required/);
let token='owner',proof={ok:true,projectId:'vault',revision:1,activeProjectId:'film-a'},calls=[];
const create=createApplicationStudioSessionFactory({
 resolveSelectionVaultId:async()=> 'vault',
 readLocalBytes:()=> 'unchanged',
 transport:async input=>{calls.push(input);return proof}
});
const session=create({getAuthToken:async()=>token});
assert.equal(session.getServices(),null);
const opened=await session.open();
assert.equal(opened.ok,true);
assert.equal(session.getServices(),opened.services);
assert.deepEqual(calls,[{path:'/studio/selection-read',token:'owner',body:{projectId:'vault'}}]);
assert.equal(opened.services.recoveryServices().selectionVaultId,'vault');
session.invalidate();
assert.equal(session.getServices(),null);
assert.throws(()=>opened.services.recoveryServices(),/owner-token-unavailable/);
console.log('GREEN APPLICATION_FACTORY_VERIFIED_VAULT_BEFORE_SERVICE_PUBLICATION');
for(const invalid of [{ok:false},{ok:true,projectId:'foreign',revision:1,activeProjectId:null},{ok:true,projectId:'vault',revision:-1,activeProjectId:null},{ok:true,projectId:'vault',revision:1}]){
 proof=invalid;
 const denied=await session.open();
 assert.equal(denied.ok,false);assert.equal(session.getServices(),null);
}
console.log('GREEN APPLICATION_FACTORY_WRONG_VAULT_DENIAL_AND_MALFORMED_PROOF_DENIAL');
let release,entered;
const started=new Promise(r=>entered=r);
const deferred=new Promise(r=>release=r);
const race=createApplicationStudioSessionFactory({resolveSelectionVaultId:async()=> 'vault',readLocalBytes:()=> 'unchanged',transport:async()=>{entered();return deferred}})({getAuthToken:async()=>token});
const pending=race.open();await started;
assert.equal(race.getServices(),null);
race.invalidate();release({ok:true,projectId:'vault',revision:1,activeProjectId:null});
assert.equal((await pending).ok,false);assert.equal(race.getServices(),null);
console.log('GREEN APPLICATION_FACTORY_DELAYED_VAULT_PROOF_AFTER_REVOCATION_DENIED');
assert.equal(readFileSync('./frontend/src/App.jsx','utf8'),app);
assert.equal(readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8'),regression);
console.log('HELD APPLICATION_ROUTE_ADOPTION_PRODUCTION_VAULT_ENDPOINT_AND_LIVE_CLERK');
