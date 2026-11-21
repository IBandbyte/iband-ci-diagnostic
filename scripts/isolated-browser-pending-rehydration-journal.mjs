// Diagnostic-only browser pending-turn journal. Local bytes are NOT publication
// authority. Recovery requires an independently authenticated server receipt and
// server readback of the same operation, revision and committed scene.
const PREFIX='movie-mentor:isolated-pending:v1:';
const clone=x=>JSON.parse(JSON.stringify(x));
const clean=x=>typeof x==='string'?x.trim():'';
export function createIsolatedBrowserPendingJournal({storage,readCommitted}={}){
 if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function'||typeof storage.removeItem!=='function'||typeof readCommitted!=='function')throw Error('durable-journal-dependency-missing');
 const key=projectId=>PREFIX+clean(projectId);
 const valid=r=>r?.version===1&&clean(r.projectId)&&clean(r.creator?.id)&&r.creator?.role==='creator'&&clean(r.creator?.text)&&clean(r.operationId)&&r.operationId==='adopt-'+r.projectId+':'+r.creator.id;
 function inspect(projectId){
  const id=clean(projectId);if(!id)return null;
  let entry;try{entry=JSON.parse(storage.getItem(key(id))||'null')}catch{return null}
  return valid(entry)&&entry.projectId===id?clone(entry):null;
 }
 function stage(projectId,creator){
  const id=clean(projectId);
  if(!id||!clean(creator?.id)||creator?.role!=='creator'||!clean(creator.text)||inspect(id))return {ok:false,reason:'invalid-or-existing-pending'};
  const record={version:1,projectId:id,creator:clone(creator),operationId:'adopt-'+id+':'+creator.id,scene:null};
  storage.setItem(key(id),JSON.stringify(record));return {ok:true,record:clone(record)};
 }
 function attach(projectId,creatorTurnId,scene){
  const old=inspect(projectId);
  if(!old||old.creator.id!==creatorTurnId||!clean(scene?.id)||!clean(scene?.text))return {ok:false};
  if(old.scene&&(old.scene.id!==scene.id||old.scene.text!==scene.text))return {ok:false};
  old.scene={id:scene.id,text:scene.text};
  storage.setItem(key(projectId),JSON.stringify(old));return {ok:true,record:clone(old)};
 }
 async function reconcile({projectId,authenticatedSession}={}){
  const current=inspect(projectId);
  if(!current)return {ok:false,reason:'no-valid-pending'};
  if(!authenticatedSession)return {ok:false,reason:'authentication-required',pending:current};
  if(!current.scene)return {ok:false,reason:'scene-not-staged',pending:current};
  let remote;
  try{remote=await readCommitted({projectId:current.projectId,operationId:current.operationId,authenticatedSession})}
  catch{return {ok:false,reason:'server-unavailable',pending:current}}
  const receipt=remote?.receipt||remote;
  const state=remote?.state||receipt?.state;
  const match=remote?.ok===true&&
   receipt?.projectId===current.projectId&&receipt?.operationId===current.operationId&&
   clean(receipt.serverCommitId)&&Number.isSafeInteger(receipt.revision)&&receipt.revision>0&&
   Array.isArray(state?.scenes)&&state.scenes.some(s=>s.id===current.scene.id&&s.text===current.scene.text);
  if(!match)return {ok:false,reason:'server-receipt-unverified',pending:current};
  // Re-read immediately before retiring to avoid deleting a newer pending turn.
  const latest=inspect(projectId);
  if(!latest||JSON.stringify(latest)!==JSON.stringify(current))return {ok:false,reason:'pending-changed'};
  storage.removeItem(key(projectId));
  return {ok:true,revision:receipt.revision,serverCommitId:receipt.serverCommitId,scene:clone(current.scene),creator:clone(current.creator),state:clone(state)};
 }
 return Object.freeze({inspect,stage,attach,reconcile});
}
