// Independent model court for the proposed server-side publication checkpoint.
// This is an isolated in-memory reference model, NOT production CreatorMemory integration.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function makeAuthority(){
 const records=new Map(),operations=new Map();
 function seed({project,owner,state}){records.set(project,{owner,ownershipRevision:1,revision:0,state,hash:digest(state)});}
 function read(project){return structuredClone(records.get(project));}
 function transfer(project,owner){const r=records.get(project);r.owner=owner;r.ownershipRevision++;}
 function commit({project,principal,ownershipRevision,expectedRevision,operationId,requestDigest,nextState}){
  const r=records.get(project);if(!r||r.owner!==principal||r.ownershipRevision!==ownershipRevision)return {kind:'denied',reason:'ownership'};
  const key=JSON.stringify([project,principal,operationId]),old=operations.get(key);
  if(old)return old.requestDigest===requestDigest?{kind:'replay',result:structuredClone(old.result)}:{kind:'denied',reason:'operation-conflict'};
  if(r.revision!==expectedRevision)return {kind:'denied',reason:'stale-revision'};
  const result={revision:r.revision+1,hash:digest(nextState),state:structuredClone(nextState)};
  Object.assign(r,result);operations.set(key,{requestDigest,result:structuredClone(result)});
  return {kind:'accepted',result:structuredClone(result)};
 }
 return {seed,read,transfer,commit};
}
const a=makeAuthority();a.seed({project:'movie-1',owner:'creator-1',state:{scene:1}});
const baseline=a.read('movie-1');
assert.equal(a.commit({project:'movie-1',principal:'intruder',ownershipRevision:1,expectedRevision:0,operationId:'evil',requestDigest:'x',nextState:{scene:999}}).kind,'denied');
assert.deepEqual(a.read('movie-1'),baseline);
const op={project:'movie-1',principal:'creator-1',ownershipRevision:1,expectedRevision:0,operationId:'scene-2',requestDigest:'scene-2-v1',nextState:{scene:2}};
const accepted=a.commit(op);assert.equal(accepted.kind,'accepted');
assert.equal(a.commit(op).kind,'replay');assert.deepEqual(a.commit(op).result,accepted.result);
assert.equal(a.commit({...op,requestDigest:'forged'}).reason,'operation-conflict');
assert.equal(a.commit({...op,operationId:'stale'}).reason,'stale-revision');
const restart=a.read('movie-1');assert.equal(restart.revision,1);assert.equal(restart.hash,digest({scene:2}));
const next=a.commit({...op,expectedRevision:restart.revision,operationId:'scene-3',requestDigest:'scene-3-v1',nextState:{scene:3}});
assert.equal(next.kind,'accepted');assert.equal(a.read('movie-1').revision,2);
a.transfer('movie-1','creator-2');const before=a.read('movie-1');
assert.equal(a.commit({...op,ownershipRevision:1,expectedRevision:2,operationId:'revoked'}).reason,'ownership');
assert.deepEqual(a.read('movie-1'),before);
console.log('GREEN MODEL_OWNER_AND_FORGED_PRINCIPAL_DENIAL');
console.log('GREEN MODEL_RESTART_POSITIVE_CAS_AND_SECOND_RESTART');
console.log('GREEN MODEL_IDEMPOTENT_REPLAY_AND_CONFLICT');
console.log('GREEN MODEL_STALE_REVISION_AND_REVOKED_OWNERSHIP_DENIAL');
console.log('SCOPE in-memory reference model only; no HTTP, Mongo, frontend, or durable process restart certification');
