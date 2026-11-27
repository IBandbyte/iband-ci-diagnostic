// Physical integration with unchanged pinned native ingress and registry.
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,sign,verify,createPublicKey,createHash} from 'node:crypto';
import express from 'express';
import http from 'node:http';
import {createMovieMentorCreatorRequestAuthority} from './ai/MovieMentorCreatorRequestAuthority.js';
import {createMovieMentorTurnRouter} from './movieMentorTurn.js';
import {createMovieMentorProductionInferenceSpendComposition} from './ai/MovieMentorProductionInferenceSpendComposition.js';
import {createMovieMentorProductionInferenceExecutionComposition} from './ai/MovieMentorProductionInferenceExecutionComposition.js';
import {createMovieMentorInferenceSettlementMongoStore} from './ai/MovieMentorInferenceSettlementMongoStore.js';
import {createMovieMentorInferenceSettlementReconciliationAuthority} from './ai/MovieMentorInferenceSettlementReconciliationAuthority.js';
import {buildRequestDigest} from './ai/MovieMentorTurnRuntime.js';
import {MOVIE_MENTOR_INFERENCE_EXECUTION_REQUIRED_UNIQUE_INDEXES as EXECUTION_REQUIRED} from './ai/MovieMentorInferenceExecutionPhysicalAuthority.js';
import {MOVIE_MENTOR_INFERENCE_SETTLEMENT_REQUIRED_UNIQUE_INDEXES as SETTLEMENT_REQUIRED} from './ai/MovieMentorInferenceSettlementPhysicalAuthority.js';
import {createPhysicalProvenanceFencedSceneSettlement} from './isolated-physical-provenance-fenced-scene-settlement.mjs';
import {spawnSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {createApplicationStudioSessionFactory} from './isolated-application-studio-session-factory.mjs';
import mongoose from 'mongoose';
import {MongoClient,UUID} from 'mongodb';
import {createMovieMentorProjectsRouter} from './movieMentorProjects.js';
import {createMovieMentorNativeProjectCreationAuthority} from './ai/MovieMentorNativeProjectCreationAuthority.js';
import {createMovieMentorProjectOwnershipAuthority} from './ai/MovieMentorProjectOwnershipRegistry.js';
import {createProvenanceAuthority} from './isolated-server-publication-provenance.mjs';
import {createWritableAdmissionGate} from './isolated-writable-admission-gate.mjs';
import {createServerProjectSelectionAuthority} from './isolated-server-original-red-project-selection.mjs';
import {createStudioOwnerVaultAuthority} from './isolated-studio-owner-vault-authority.mjs';
import {createNativeFilmRegistration} from './isolated-native-film-registration.mjs';
const uri=process.env.MONGO_URI;
assert.match(uri,/^mongodb:\/\/127\.0\.0\.1:27017\//);
const client=new MongoClient(uri);await client.connect();
const db=client.db('isolated_native_film_registration');
const {publicKey,privateKey}=process.env.NATIVE_RECOVERY_PUBLIC_KEY?{publicKey:createPublicKey(process.env.NATIVE_RECOVERY_PUBLIC_KEY),privateKey:null}:generateKeyPairSync('rsa',{modulusLength:2048});
const now=Math.floor(Date.now()/1000),b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const issuer='https://isolated-auth.test',audience='movie-mentor-creator-write';
function jwt(sub){const data=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:issuer,aud:audience,sub,iat:now,nbf:now-1,exp:now+600});return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')}
function authenticate(token){try{const [h,p,s]=token.split('.');const claims=JSON.parse(Buffer.from(p,'base64url'));return JSON.parse(Buffer.from(h,'base64url')).alg==='RS256'&&verify('RSA-SHA256',Buffer.from(h+'.'+p),publicKey,Buffer.from(s,'base64url'))&&claims.iss===issuer&&claims.aud===audience&&claims.exp>Math.floor(Date.now()/1000)&&claims.nbf<=Math.floor(Date.now()/1000)?claims.sub:null}catch{return null}}
const ownerId=process.env.NATIVE_RECOVERY_OWNER_ID||'native-owner-'+randomUUID(),owner=process.env.NATIVE_RECOVERY_OWNER_TOKEN||jwt(ownerId),foreign=process.env.NATIVE_RECOVERY_FOREIGN_TOKEN||jwt('foreign');
let server;
try{
 await mongoose.connect(uri,{autoIndex:false});
 const registry=mongoose.connection.collection('movie_mentor_project_ownership');
 await registry.createIndex({projectId:1},{unique:true});
 await registry.createIndex({establishmentAuthorityId:1},{unique:true});
 const ownershipAuthority=createMovieMentorProjectOwnershipAuthority();
 const nativeProjectCreationAuthority=createMovieMentorNativeProjectCreationAuthority({ownershipAuthority,expectedIssuer:issuer,expectedAudience:audience,verifyCredential:async({credential})=>{
  const subject=authenticate(credential);if(!subject)throw Error('invalid token');
  return {verified:true,subject,issuer,audience,verificationMethod:'RS256-test',verificationVersion:'1',authenticatedAt:new Date(now*1000),expiresAt:new Date((now+600)*1000),active:true,revoked:false};
 }});
 const provenance=createProvenanceAuthority({db,client,publicKey});
 const gate=createWritableAdmissionGate({db,client,publicKey});
 const registrationIntents=db.collection('native_registration_intents');
 const registrationCompletions=db.collection('native_registration_completions');
 await registrationIntents.createIndex({ownerId:1},{unique:true});
 await registrationCompletions.createIndex({ownerId:1,projectId:1},{unique:true});
 const selection=createServerProjectSelectionAuthority({gate,db,client,registrationIntents});
 const bindings=db.collection('studio_owner_vault_bindings'),projects=db.collection('projects');
 const vaults=createStudioOwnerVaultAuthority({bindings,states:provenance.states,ledger:provenance.ledger,client,authenticateOwner:authenticate,readSelection:selection.read});
 await vaults.initialize();await selection.receipts.createIndex({projectId:1,operationId:1},{unique:true});
 let canonicalRegistrationEnabled=false;
 let failNextRegistration=false,dropNextRegistrationAck=false,failedRegistrationId=null,droppedRegistrationId=null;
 let initialRegistrationArrivals=0,initialRegistrationRelease;const initialRegistrationBarrier=new Promise(r=>initialRegistrationRelease=r);
 const canonicalCreatorStates=client.db(mongoose.connection.db.databaseName).collection('movie_mentor_creator_state');
 const registration=createNativeFilmRegistration({client,states:provenance.states,ledger:provenance.ledger,bindings,projects,ownershipAuthority,authenticateOwner:authenticate,canonicalCreatorStates,canonicalEnabled:()=>canonicalRegistrationEnabled,beforeCommit:async({projectId,canonical,session})=>{if(canonical&&process.env.NATIVE_PRECOMMIT_PAUSE){
  writeFileSync(process.env.NATIVE_PRECOMMIT_PAUSE,JSON.stringify({pid:process.pid,projectId,arrivals:initialRegistrationArrivals,sessionId:session.id.id.toUUID().toString()}));
  await new Promise(()=>{});
 }if(canonical&&failNextRegistration){failNextRegistration=false;failedRegistrationId=projectId;throw Error('isolated-registration-interruption');}}});
 const receipts=db.collection('native_conversation_receipts');
 await receipts.createIndex({projectId:1,operationId:1},{unique:true});await receipts.createIndex({projectId:1,creatorTurnId:1},{unique:true});
 const settlement=createPhysicalProvenanceFencedSceneSettlement({client,gate,projects,receipts});
 const app=express();app.use(express.json());app.use('/api/movie-mentor',createMovieMentorProjectsRouter({nativeProjectCreationAuthority}));
 app.post('/studio/native-film-register',async(req,res)=>{
  if(process.env.NATIVE_INITIAL_PROVISION_WORKER){
   initialRegistrationArrivals++;
   if(initialRegistrationArrivals===2)initialRegistrationRelease();
   await initialRegistrationBarrier;
  }
  let result;
  try{result=await registration.register({token:req.get('authorization')?.replace(/^Bearer /,''),projectId:req.body.projectId});}
  catch(error){if(error.message!=='isolated-registration-interruption')throw error;return res.json({ok:false,reason:'isolated-registration-interruption'});}
  if(process.env.NATIVE_INITIAL_PROVISION_WORKER&&result.ok){
   // Never acknowledge either request; the supervisor observes the durable commit and terminates this worker.
   return;
  }
  if(dropNextRegistrationAck&&result.ok&&!result.replayed){dropNextRegistrationAck=false;droppedRegistrationId=result.projectId;res.socket.destroy();return;}
  return res.json(result);
 });
 app.post('/studio/native-registration-intent',async(req,res)=>{
  const ownerId=authenticate(req.get('authorization')?.replace(/^Bearer /,''));
  if(!ownerId)return res.json({ok:false});
  if(!canonicalRegistrationEnabled)return res.json({ok:true,enabled:false});
  const projectId=req.body.projectId;
  if(projectId!==undefined){
   if(typeof projectId!=='string'||!/^movie-project-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId))return res.json({ok:false});
   try{await registrationIntents.updateOne({ownerId},{$setOnInsert:{ownerId,projectId,createdAt:new Date()}},{upsert:true});}catch(e){if(e.code!==11000)throw e;}
  }
  const intent=await registrationIntents.findOne({ownerId});
  return res.json({ok:true,enabled:true,...(intent?{projectId:intent.projectId}:{})});
 });
 app.post('/studio/native-registration-complete',async(req,res)=>{
  const token=req.get('authorization')?.replace(/^Bearer /,''),ownerId=authenticate(token),projectId=req.body.projectId;
  if(!ownerId||!canonicalRegistrationEnabled||typeof projectId!=='string')return res.json({ok:false});
  const binding=await bindings.findOne({ownerId,revoked:false});
  if(!binding)return res.json({ok:false});
  const selected=await selection.read({token,projectId:binding.vaultId});
  const proof=await ownershipAuthority.authorizeProject({principal:{authenticated:true,principalId:ownerId},projectId});
  if(!selected.ok||selected.activeProjectId!==projectId||proof?.authorized!==true||!await projects.findOne({_id:projectId,ownerId})||!await canonicalCreatorStates.findOne({projectId}))return res.json({ok:false});
  const session=client.startSession();
  try{
   const result=await session.withTransaction(async()=>{
    const pending=await registrationIntents.findOne({ownerId},{session});
    if(pending&&pending.projectId!==projectId)return {ok:false,reason:'newer-registration-pending'};
    const vault=await gate.states.findOne({projectId:binding.vaultId,ownerId,revoked:false},{session});
    if(vault?.state?.content?.activeProjectId!==projectId)return {ok:false,reason:'registration-selection-changed'};
    const fence=await gate.states.updateOne({_id:vault._id,revision:vault.revision},{$inc:{registrationCompletionFence:1}},{session});
    if(fence.modifiedCount!==1)throw Error('registration-completion-fence-conflict');
    if(!pending)return await registrationCompletions.findOne({ownerId,projectId},{session})?{ok:true,replayed:true}:{ok:false};
    await registrationCompletions.insertOne({ownerId,projectId,completedAt:new Date()},{session});
    const cleared=await registrationIntents.deleteOne({_id:pending._id},{session});
    if(cleared.deletedCount!==1)throw Error('registration-completion-conflict');
    return {ok:true,replayed:false};
   },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
   return res.json(result);
  }finally{await session.endSession()}
 });
 app.post('/studio/selection-vault',async(req,res)=>res.json(await vaults.resolve({token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/selection-read',async(req,res)=>res.json(await selection.read({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/selection-change',async(req,res)=>res.json(await selection.select({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/read',async(req,res)=>{
  const sub=authenticate(req.get('authorization')?.replace(/^Bearer /,''));
  const projectId=req.body.projectId;
  if(!sub)return res.json({ok:false});
  const proof=await ownershipAuthority.authorizeProject({principal:{authenticated:true,principalId:sub},projectId});
  if(proof?.authorized!==true)return res.json({ok:false});
  const p=await projects.findOne({_id:projectId,ownerId:sub});
  const canonical=await provenance.states.findOne({projectId,ownerId:sub,revoked:false});
  const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
  if(!p||!canonical||p.revision!==canonical.revision||hash(p.state)!==hash(canonical.state.content))return res.json({ok:false});
  const records=await provenance.ledger.find({projectId,ownerId:sub,ownershipRevision:canonical.ownershipRevision},{ }).sort({revision:1}).toArray();
  const outbox=canonical.state.durablePublicationOutbox;
  if(!Array.isArray(outbox)||!records.length||records.length!==outbox.length||records.some((r,i)=>hash(r.entry)!==hash(outbox[i]))||records.at(-1).stateDigest!==hash(canonical.state)||records.at(-1).fullOutboxDigest!==hash(outbox))return res.json({ok:false});
  return res.json({ok:true,projectId:p._id,revision:p.revision,state:p.state});
 });
 app.post('/studio/publication-grant',async(req,res)=>{
  const {projectId,revision}=req.body;
  const grant=await provenance.issue({projectId,revision,token:req.get('authorization')?.replace(/^Bearer /,'')});
  return res.json(grant?.grantId?{grantId:grant.grantId,projectId,revision}:null);
 });
 app.post('/studio/admit-publication',async(req,res)=>res.json(await gate.admit({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/read-admission',async(req,res)=>res.json(await gate.readAdmission({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/native-conversation-receipt',async(req,res)=>res.json(await settlement.readConversationReceipt({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 app.post('/studio/native-conversation-retire',async(req,res)=>res.json(await settlement.retireConversationWriter({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 let recoverCanonicalUnpublished=null;
 app.post('/studio/native-conversation-recover',async(req,res)=>{
  const input={...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')};
  const prior=await settlement.recoverInterruptedConversation(input);
  if(prior.reason==='unsettled-writer-held'&&recoverCanonicalUnpublished)return res.json(await recoverCanonicalUnpublished(input));
  return res.json(prior);
 });
 app.post('/studio/native-conversation-cancel',async(req,res)=>res.json(await settlement.cancelUncommittedConversation({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
 let dropNextConversationAck=false,droppedAcks=0;
 app.post('/studio/native-conversation-settle',async(req,res)=>{
  const result=await settlement.settleConversation({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')});
  if(dropNextConversationAck&&result.ok&&!result.replay){dropNextConversationAck=false;droppedAcks++;res.socket.destroy();return;}
  return res.json(result);
 });
 async function startIsolatedProvider(){
   process.env.IBAND_AI_PROVIDER='openai';
   process.env.IBAND_AI_MODEL='gpt-isolated';
   process.env.IBAND_AI_API_KEY='isolated-only';
 const providerRequests=[];
 const providerServer=http.createServer(async(req,res)=>{
  let body="";for await(const chunk of req)body+=chunk;
  providerRequests.push({path:req.url,method:req.method,idempotencyKey:req.headers["idempotency-key"]||null});
  let requestBody;
  try{requestBody=JSON.parse(body);}catch{
   res.writeHead(400,{"content-type":"application/json"});
   res.end(JSON.stringify({error:{message:"Invalid isolated provider JSON"}}));
   return;
  }
  const schema=requestBody?.text?.format?.schema;
  console.log("PHYSICAL POSITIVE PROVIDER SCHEMA: "+JSON.stringify({
   schemaName:requestBody?.text?.format?.name||null,
   topLevelRequired:Array.isArray(schema?.required)?schema.required:[],
   topLevelProperties:Object.keys(schema?.properties||{}),
   propertyContracts:Object.fromEntries(Object.entries(schema?.properties||{}).map(([key,value])=>[key,{type:value?.type||null,required:value?.required||[],properties:Object.keys(value?.properties||{}),itemsType:value?.items?.type||null,itemRequired:value?.items?.required||[],itemProperties:Object.fromEntries(Object.entries(value?.items?.properties||{}).map(([k,v])=>[k,{type:v?.type||null,enum:v?.enum||null}])),nextActionRequired:value?.properties?.required||[],nextActionProperties:Object.fromEntries(Object.entries(value?.properties||{}).map(([k,v])=>[k,{type:v?.type||null,enum:v?.enum||null}])),enum:value?.enum||null}])),
   model:requestBody?.model||null
  }));
  if(requestBody?.text?.format?.name==="movie_journey_intelligence"){
   const semantic={
    understoodContext:[{key:"creator.intent",value:"isolated positive creator turn",evidence:"isolated positive creator turn",confidenceSource:"creator-explicit"}],
    provisionalContext:[],unresolvedContext:[],clarificationNeeded:[],readyToAdvance:true,
    recommendedStageId:null,recommendedTaskId:null,nextAction:null,resumeNote:null
   };
   res.writeHead(200,{"content-type":"application/json"});
   res.end(JSON.stringify({id:"isolated-semantic-response-1",model:"gpt-isolated",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(semantic)}]}]}));
   return;
  }
  const schemaName=requestBody?.text?.format?.name||"";
  if(["movie_mentor_story_contribution","movie_mentor_character_contribution","movie_mentor_continuity_contribution"].includes(schemaName)){
   const requiredAgent=schema?.properties?.agentId?.enum?.[0];
   const fixture={
    agentId:requiredAgent,
    confidence:0.9,
    provenance:{source:"isolated-local-provider",model:"gpt-isolated",contractVersion:"1"},
   };
   for(const field of schema?.required||[]){
    if(field in fixture)continue;
    const property=schema?.properties?.[field];
    if(property?.type==="array")fixture[field]=[];
    else if(property?.type==="boolean")fixture[field]=false;
    else if(property?.type==="number")fixture[field]=0.9;
    else if(property?.type==="string")fixture[field]=property?.enum?.[0]||"isolated";
    else if(property?.type==="object")fixture[field]={};
    else fixture[field]=null;
   }
   const responseId="isolated-"+schemaName+"-"+providerRequests.length;
   res.writeHead(200,{"content-type":"application/json"});
   res.end(JSON.stringify({id:responseId,model:"gpt-isolated",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(fixture)}]}]}));
   return;
  }
  if(schemaName==="movie_mentor_synthesis"){
   const synthesis={
    text:"I understand your isolated creator request. What would you like to develop next?",
    usedContributionAgentIds:["story","character","continuity"],
    deferredContributionAgentIds:[],
    continuationObedienceClaims:[],
    conflictsHandled:[],
    confidence:0.9,
    provenance:{source:"isolated-local-provider",model:"gpt-isolated",contractVersion:"1"}
   };
   res.writeHead(200,{"content-type":"application/json"});
   res.end(JSON.stringify({id:"isolated-synthesis-response-1",model:"gpt-isolated",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(synthesis)}]}]}));
   return;
  }
  res.writeHead(503,{"content-type":"application/json"});
  res.end(JSON.stringify({error:{message:"Unimplemented isolated provider stage: "+String(requestBody?.text?.format?.name||"unknown"),type:"isolated_fixture_pending"}}));
 });

   await new Promise(resolve=>providerServer.listen(0,'127.0.0.1',resolve));
   process.env.IBAND_AI_BASE_URL='http://127.0.0.1:'+providerServer.address().port+'/v1/responses';

 return {providerServer,providerRequests};
 }
 async function composeCanonicalExecution(){
    const spend=createMovieMentorProductionInferenceSpendComposition(),execution=createMovieMentorProductionInferenceExecutionComposition();
    assert.equal(spend.ready,true);assert.equal(execution.ready,true);
    const accounting=createMovieMentorInferenceSettlementReconciliationAuthority({store:createMovieMentorInferenceSettlementMongoStore()});
    const requestAuthority=createMovieMentorCreatorRequestAuthority({expectedIssuer:issuer,expectedAudience:audience,ownershipAuthority,verifyCredential:async({credential})=>{
     const subject=authenticate(credential);if(!subject)throw Error('invalid token');
     return {verified:true,subject,issuer,audience,verificationMethod:'RS256-test',verificationVersion:'1',authenticatedAt:new Date(now*1000),expiresAt:new Date((now+600)*1000),active:true,revoked:false};
    }});
    const executionApp=express();executionApp.use(express.json());
    executionApp.use('/api/movie-mentor',createMovieMentorTurnRouter({requestAuthority,inferenceSpendAuthority:spend.authority,inferenceExecutionAuthority:execution.authority,inferenceSettlementAuthority:accounting}));
    const {strict,hash}=composeCanonicalRecovery(execution,accounting,(...args)=>call(...args));
    executionApp.post('/studio/strict-conversation-settle',async(req,res)=>res.json(await strict.settleConversation({...req.body,token:req.get('authorization')?.replace(/^Bearer /,'')})));
    const executionServer=executionApp.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{executionServer.once('listening',resolve);executionServer.once('error',reject)});
    const call=async(path,body,token=owner)=>{const response=await fetch('http://127.0.0.1:'+executionServer.address().port+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()}};

 return {strict,hash,call,execution,server:executionServer};
 }
 async function registerCanonicalSubmission(strict,call){
    await canonicalCreatorStates.createIndex({projectId:1},{unique:true,partialFilterExpression:{projectId:{$type:'string'}}});
    canonicalRegistrationEnabled=true;
    const strictBindings=db.collection('native_execution_initiation_bindings');
    await strictBindings.createIndex({ownerId:1,projectId:1,creatorTurnId:1},{unique:true});
    await strictBindings.createIndex({ownerId:1,projectId:1,fence:1},{unique:true});
    app.post('/studio/native-execution-initiate',async(req,res)=>{
     const token=req.get('authorization')?.replace(/^Bearer /,''),subject=authenticate(token);
     const {projectId,selectionVaultId,operationId,creatorTurnId,expectedRevision,fence,creatorMessage,requestDigest}=req.body||{};
     const deny=()=>res.json({ok:false});
     if(!subject||typeof projectId!=='string'||typeof selectionVaultId!=='string'||typeof operationId!=='string'||typeof fence!=='string'||!Number.isSafeInteger(expectedRevision)||typeof creatorTurnId!=='string'||creatorMessage?.id!==creatorTurnId||creatorMessage.role!=='creator'||typeof creatorMessage.text!=='string'||!creatorMessage.text.trim()||creatorMessage.text!==creatorMessage.text.trim()||Object.hasOwn(req.body,'mentorMessage'))return deny();
     const digest=buildRequestDigest({creatorMessage:creatorMessage.text,projectId,options:{}});
     if(requestDigest!==digest)return deny();
     const ownership=await ownershipAuthority.authorizeProject({principal:{authenticated:true,principalId:subject},projectId});
     if(ownership?.authorized!==true)return deny();
     const session=client.startSession();
     let bound;
     try{bound=await session.withTransaction(async()=>{
      const vault=await gate.states.findOne({projectId:selectionVaultId,ownerId:subject,revoked:false,'state.content.activeProjectId':projectId},{session});
      const writer=await gate.admissions.findOne({projectId,ownerId:subject,fence,status:'admitted',revision:expectedRevision},{session});
      if(!vault||!writer||operationId!==writer.operationId+':'+creatorTurnId)return false;
      const state=await gate.states.findOne({projectId,ownerId:subject,revoked:false,revision:expectedRevision,ownershipRevision:writer.ownershipRevision,activeWriterFence:fence,activeAdoptionGrant:writer.grantId},{session});
      if(!state||state.strictCanonicalConversation!==true)return false;
      const identity={ownerId:subject,projectId,creatorTurnId};
      const binding={...identity,selectionVaultId,operationId,expectedRevision,fence,requestDigest:digest};
      const prior=await strictBindings.findOne(identity,{session});
      if(prior&&Object.entries(binding).some(([k,val])=>prior[k]!==val))return false;
      const lock=await gate.states.updateOne({_id:vault._id,revision:vault.revision,revoked:false,'state.content.activeProjectId':projectId},{$inc:{nativeExecutionInitiationFence:1}},{session});
      const writerLock=await gate.states.updateOne({_id:state._id,revision:expectedRevision,activeWriterFence:fence,revoked:false},{$inc:{nativeExecutionInitiationFence:1},$set:{nativeExecutionBoundWriterFence:fence}},{session});
      if(lock.modifiedCount!==1||writerLock.modifiedCount!==1)throw Error('native-initiation-race');
      if(!prior)await strictBindings.insertOne({...binding,creatorText:creatorMessage.text},{session});
      return true;
     },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}})}catch{return deny()}finally{await session.endSession()}
     if(!bound)return deny();
     if(process.env.NATIVE_BOUND_WORKER_PAUSE&&!process.env.NATIVE_BOUND_WORKER_SETTLED){
      writeFileSync(process.env.NATIVE_BOUND_WORKER_PAUSE,JSON.stringify({pid:process.pid,projectId,creatorTurnId,fence,requestDigest:digest}));
      await new Promise(()=>{});
     }
     const response=await call('/api/movie-mentor/turn',{projectId,creatorTurnId,message:creatorMessage.text,options:{}},token);
     if(response.status!==200||response.body?.success!==true||response.body.status!=='mentor-response-ready'||typeof response.body.text!=='string')return deny();
     const mentorMessage={id:'mentor-'+creatorTurnId,role:'mentor',text:response.body.text,metadata:{backendMetadata:{creatorTurnId}}};
     if(process.env.NATIVE_BOUND_WORKER_SETTLED&&!process.env.NATIVE_BOUND_WORKER_PUBLISHED&&!process.env.NATIVE_BOUND_WORKER_PRECOMMIT){
      writeFileSync(process.env.NATIVE_BOUND_WORKER_PAUSE,JSON.stringify({pid:process.pid,projectId,creatorTurnId,fence,requestDigest:digest,mentorMessage}));
      await new Promise(()=>{});
     }
     return res.json({ok:true,projectId,creatorTurnId,requestDigest:digest,mentorMessage});
    });
    app.post('/studio/strict-conversation-settle',async(req,res)=>{
     const token=req.get('authorization')?.replace(/^Bearer /,''),subject=authenticate(token),body=req.body||{};
     if(!subject)return res.json({ok:false});
     const binding=await strictBindings.findOne({ownerId:subject,projectId:body.projectId,creatorTurnId:body.creatorTurnId,operationId:body.operationId,fence:body.fence,expectedRevision:body.expectedRevision,selectionVaultId:body.selectionVaultId});
     if(!binding||binding.requestDigest!==buildRequestDigest({creatorMessage:body.creatorMessage?.text?.trim()||'',projectId:body.projectId,options:{}}))return res.json({ok:false});
     const result=await strict.settleConversation({...body,token});
     if(process.env.NATIVE_BOUND_WORKER_PUBLISHED&&result.ok&&!result.replay){
      writeFileSync(process.env.NATIVE_BOUND_WORKER_PAUSE,JSON.stringify({pid:process.pid,projectId:body.projectId,creatorTurnId:body.creatorTurnId,fence:body.fence,receipt:result}));
      await new Promise(()=>{});
     }
     return res.json(result);
    });

 }
 function composeCanonicalRecovery(execution,accounting,dispatchBoundTurn){
    const authorityDb=mongoose.connection.db;
    const strictBindings=db.collection('native_execution_initiation_bindings');
    const canonicalize=x=>x===null||typeof x!=='object'?x:Array.isArray(x)?x.map(canonicalize):Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonicalize(x[k])]));
    const hash=x=>createHash('sha256').update(JSON.stringify(canonicalize(x))).digest('hex');
    const strict=createPhysicalProvenanceFencedSceneSettlement({client,gate,projects,receipts,beforeConversationCommit:process.env.NATIVE_BOUND_WORKER_PRECOMMIT?async({session,projectId,operationId,creatorTurnId,fence,revision,commitId})=>{
     assert.equal(session.inTransaction(),true);
     const staged=await receipts.findOne({projectId,operationId},{session});assert.equal(staged.commitId,commitId);
     assert.equal((await projects.findOne({_id:projectId},{session})).revision,revision);
     assert.equal((await gate.states.findOne({projectId,revoked:false},{session})).revision,revision);
     assert.ok(await gate.ledger.findOne({projectId,operationId,revision},{session}));
     writeFileSync(process.env.NATIVE_BOUND_WORKER_PAUSE,JSON.stringify({pid:process.pid,projectId,operationId,creatorTurnId,fence,revision,commitId,sessionId:session.id.id.toUUID().toString()}));
     await new Promise(()=>{});
    }:null,verifyMentorExecution:async({ownerId,projectId,creatorTurnId,creatorMessage,mentorMessage})=>{
     const requestDigest=buildRequestDigest({creatorMessage:creatorMessage.text.trim(),projectId,options:{}});
     const row=await mongoose.connection.db.collection('movie_mentor_inference_execution').findOne({principalId:ownerId,projectId,creatorTurnId,requestDigest,phase:'settled'});
     if(!row?.executionId)return false;
     const c=await execution.authority.readCanonicalResult({executionId:row.executionId});
     if(c?.authorized!==true||c.committed!==true||c.currentRealityVerified!==true||c.candidateLineageVerified!==true||c.resultFinalizationVerified!==true||c.executionPhase!=='settled'||c.principalId!==ownerId||c.projectId!==projectId||c.creatorTurnId!==creatorTurnId||c.requestDigest!==requestDigest||!c.resultPayload||hash(c.resultPayload)!==c.resultDigest||c.resultPayload.text!==mentorMessage.text)return false;
     const a=await accounting.reconcile({executionId:row.executionId});
     return a?.authorized===true&&a.settled===true&&a.outcome==='consumed'&&a.resultFinalizationVerified===true&&a.executionPhase==='settled'&&['executionId','principalId','projectId','reservationId','resultReference','candidateReference','resultDigest','closureCertificateDigest','providerEffectRealityRevision'].every(k=>a[k]!==undefined&&a[k]===c[k]);
    }});

    recoverCanonicalUnpublished=async({token,selectionVaultId,projectId})=>{
     const ownerId=authenticate(token),deny={ok:false,reason:'unsettled-writer-held'};
     if(!ownerId)return deny;
     const vault=await gate.states.findOne({projectId:selectionVaultId,ownerId,revoked:false,'state.content.activeProjectId':projectId});
     const state=await gate.states.findOne({projectId,ownerId,revoked:false,strictCanonicalConversation:true});
     if(!vault||!state)return deny;
     if(!state.activeWriterFence)return settlement.recoverInterruptedConversation({token,selectionVaultId,projectId});
     const binding=await strictBindings.findOne({ownerId,projectId,selectionVaultId,fence:state.activeWriterFence,expectedRevision:state.revision});
     if(!binding||typeof binding.creatorText!=='string'||binding.requestDigest!==buildRequestDigest({creatorMessage:binding.creatorText,projectId,options:{}}))return settlement.recoverInterruptedConversation({token,selectionVaultId,projectId});
     const executions=authorityDb.collection('movie_mentor_inference_execution');
     const identity={principalId:ownerId,projectId,creatorTurnId:binding.creatorTurnId,requestDigest:binding.requestDigest};
     let row=await executions.findOne({...identity,phase:'settled'});
     if(!row?.executionId&&dispatchBoundTurn){
      // Resume only the exact durable bound creator turn through the existing
      // authenticated canonical execution authority. Never synthesize a result
      // or allocate a new turn identity. Its durable execution admission owns
      // provider dispatch and accounting under concurrent recovery.
      const admission=await gate.admissions.findOne({ownerId,projectId,fence:binding.fence,revision:binding.expectedRevision,status:'admitted',grantId:state.activeAdoptionGrant,ownershipRevision:state.ownershipRevision});
      if(!admission||state.nativeExecutionBoundWriterFence!==binding.fence||binding.operationId!==admission.operationId+':'+binding.creatorTurnId)return deny;
      const ownership=await ownershipAuthority.authorizeProject({principal:{authenticated:true,principalId:ownerId},projectId});
      if(ownership?.authorized!==true)return deny;
      const response=await dispatchBoundTurn('/api/movie-mentor/turn',{projectId,creatorTurnId:binding.creatorTurnId,message:binding.creatorText,options:{}},token);
      // A competing caller may already have settled and retired this writer.
      // Re-read durable authority rather than treating its response as proof.
      row=await executions.findOne({...identity,phase:'settled'});
      if(!row?.executionId){
       const recovered=await settlement.recoverInterruptedConversation({token,selectionVaultId,projectId});
       if(recovered.ok)return recovered;
       // The canonical endpoint may deny an overlapping in-flight request.
       // Observe only the original execution, with bounded read-only polling.
       if(response.status!==200||response.body?.status!=='mentor-response-ready'){
        for(let attempt=0;attempt<100&&!row?.executionId;attempt++){
         await new Promise(r=>setTimeout(r,100));
         row=await executions.findOne({...identity,phase:'settled'});
        }
       }
      }
     }
     if(!row?.executionId)return deny;
     const result=await execution.authority.readCanonicalResult({executionId:row.executionId});
     if(result?.authorized!==true||typeof result.resultPayload?.text!=='string')return deny;
     const creatorMessage={id:binding.creatorTurnId,role:'creator',text:binding.creatorText};
     const mentorMessage={id:'mentor-'+binding.creatorTurnId,role:'mentor',text:result.resultPayload.text,metadata:{backendMetadata:{creatorTurnId:binding.creatorTurnId}}};
     const committed=await strict.settleConversation({token,selectionVaultId,projectId,operationId:binding.operationId,creatorTurnId:binding.creatorTurnId,expectedRevision:binding.expectedRevision,fence:binding.fence,creatorMessage,mentorMessage});
     if(!committed.ok)return settlement.recoverInterruptedConversation({token,selectionVaultId,projectId});
     return settlement.recoverInterruptedConversation({token,selectionVaultId,projectId});
    };

    return {strict,hash};
 }
 server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 if(process.env.NATIVE_BOUND_WORKER_MANIFEST){
  const {providerRequests}=await startIsolatedProvider();
  const composed=await composeCanonicalExecution();
  await registerCanonicalSubmission(composed.strict,async(...args)=>{
   if(!process.env.NATIVE_BOUND_WORKER_SETTLED)assert.fail('paused binding worker must never reach provider dispatch');
   const result=await composed.call(...args);
   assert.equal(providerRequests.length,5);
   return result;
  });
  assert.equal(providerRequests.length,0);
  writeFileSync(process.env.NATIVE_BOUND_WORKER_MANIFEST,JSON.stringify({pid:process.pid,port:server.address().port}));
  await new Promise(()=>{});
 }else if(process.env.NATIVE_INITIAL_PROVISION_WORKER){
  await canonicalCreatorStates.createIndex({projectId:1},{unique:true,partialFilterExpression:{projectId:{$type:'string'}}});
  canonicalRegistrationEnabled=true;
  writeFileSync(process.env.NATIVE_INITIAL_PROVISION_WORKER,JSON.stringify({pid:process.pid,port:server.address().port}));
  await new Promise(()=>{});
 }else if(process.env.NATIVE_INITIAL_PROVISION_RECOVERY){
  const proof=JSON.parse(process.env.NATIVE_INITIAL_PROVISION_RECOVERY);
  assert.notEqual(process.pid,proof.workerPid);
  const transport=async({path,token,body})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return r.json()};
  const {providerServer,providerRequests}=await startIsolatedProvider();
  let executionServer,browser,peerBrowser,vite;
  const candidate=JSON.parse(readFileSync(process.env.NATIVE_RESTART_BROWSER_MANIFEST,'utf8')).browserCandidate;
  const root='../frontend/',base=candidate.base,config=root+base+'.config.mjs';
  try{
   const composed=await composeCanonicalExecution();executionServer=composed.server;
   await registerCanonicalSubmission(composed.strict,composed.call);
   const entitlement=mongoose.connection.db.collection('movie_mentor_inference_entitlement');
   const pending=await transport({path:'/studio/native-registration-intent',token:owner,body:{}});
   assert.equal(pending.projectId,proof.projectId);
   const provisioned=proof.precommit?0:1;
   assert.equal(await projects.countDocuments({ownerId}),proof.count+provisioned);
   assert.equal(await canonicalCreatorStates.countDocuments({projectId:proof.projectId}),provisioned);
   assert.equal(await gate.states.countDocuments({projectId:proof.projectId}),provisioned);
   assert.equal(await provenance.ledger.countDocuments({projectId:proof.projectId}),provisioned);
   if(proof.precommit){
    assert.deepEqual(await selection.read({token:owner,projectId:proof.vaultId}),proof.selectionBefore);
    assert.equal(await provenance.ledger.countDocuments({projectId:proof.vaultId,operationId:'register:'+proof.projectId}),0);
    assert.equal(await registrationCompletions.countDocuments({ownerId,projectId:proof.projectId}),0);
   }
   assert.equal(await receipts.countDocuments({projectId:proof.projectId}),0);
   assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,proof.consumed);
   assert.equal((await selection.read({token:owner,projectId:proof.vaultId})).activeProjectId,proof.previousSelection);
   assert.notEqual((await transport({path:'/studio/native-registration-intent',token:foreign,body:{}})).projectId,proof.projectId);
   for(const file of candidate.files)writeFileSync(file.path,file.content);
   writeFileSync(config,`import {defineConfig} from 'vite';import react from '@vitejs/plugin-react-swc';export default defineConfig({plugins:[react()],server:{proxy:{'/native-authority':{target:'http://127.0.0.1:${server.address().port}',changeOrigin:true,rewrite:path=>path.replace(/^\\/native-authority/,'')}}}});`);
   vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port','52770','--strictPort','--config',base+'.config.mjs'],{cwd:root,stdio:['ignore','pipe','pipe']});
   let output='';vite.stdout.on('data',x=>output+=x);vite.stderr.on('data',x=>output+=x);
   const url='http://127.0.0.1:52770/'+base+'.html';
   let ready=false;for(let i=0;i<100;i++){try{if((await fetch(url)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}assert.ok(ready,output);
   const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});const page=await browser.newPage();
   const signIn=async()=>{await page.goto(url);await page.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000});await page.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner)};
    const recoveryTrace=[];
    page.on('response',async response=>{
     const pathname=new URL(response.url()).pathname;
     if(!pathname.startsWith('/native-authority/'))return;
     try{const data=await response.json();recoveryTrace.push({path:pathname,status:response.status(),ok:data.ok,success:data.success,reason:data.reason,projectId:data.projectId});}
     catch{recoveryTrace.push({path:pathname,status:response.status()});}
    });
    page.on('requestfailed',request=>recoveryTrace.push({path:new URL(request.url()).pathname,failure:request.failure()?.errorText}));
    page.on('pageerror',error=>recoveryTrace.push({pageError:error.message}));
    if(proof.precommit){
     const deadline=Date.now()+95000;
     while(true){
      const ops=await client.db('admin').aggregate([{$currentOp:{allUsers:true,idleSessions:true}},{$match:{'lsid.id':new UUID(proof.abandonedSessionId),transaction:{$exists:true}}}]).toArray();
      if(!ops.length)break;
      assert.ok(Date.now()<deadline,'abandoned registration transaction not reaped');
      await new Promise(r=>setTimeout(r,250));
     }
     console.log('PHYSICAL_PRECOMMIT_ABANDONED_TRANSACTION_REAPED');
    }
    let peer,peerSignIn;
    if(proof.concurrent){
     peerBrowser=await chromium.launch({headless:true});peer=await peerBrowser.newPage();
     peerSignIn=async()=>{await peer.goto(url);await peer.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000});await peer.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner)};
     // Capture both real intent responses before either browser proceeds.
     const intentSeen=new Set(),registrationSeen=new Set(),completionSeen=new Set(),completionResults=[];
     let releaseIntent,releaseRegistration,releaseCompletion;
     const intentBarrier=new Promise(r=>releaseIntent=r),registrationBarrier=new Promise(r=>releaseRegistration=r),completionBarrier=new Promise(r=>releaseCompletion=r);
     for(const [label,p] of [['A',page],['B',peer]]){
      await p.route('**/native-authority/studio/native-registration-intent',async route=>{
       const response=await route.fetch(),body=await response.json();
       if(body.projectId===proof.projectId&&!intentSeen.has(label)){intentSeen.add(label);if(intentSeen.size===2)releaseIntent();await intentBarrier;}
       await route.fulfill({response});
      });
      await p.route('**/native-authority/studio/native-film-register',async route=>{
       assert.equal(route.request().postDataJSON().projectId,proof.projectId);
       if(!registrationSeen.has(label)){registrationSeen.add(label);if(registrationSeen.size===2)releaseRegistration();await registrationBarrier;}
       await route.continue();
      });
      await p.route('**/native-authority/studio/native-registration-complete',async route=>{
       assert.equal(route.request().postDataJSON().projectId,proof.projectId);
       if(!completionSeen.has(label)){completionSeen.add(label);if(completionSeen.size===2)releaseCompletion();await completionBarrier;}
       const response=await route.fetch(),body=await response.json();completionResults.push({label,...body});await route.fulfill({response});
      });
     }
     await Promise.all([signIn(),peerSignIn()]);
     try{await Promise.all([page,peer].map(p=>p.waitForFunction(id=>document.querySelector('[aria-label="Verified native movie"]')?.textContent===id,proof.projectId,{timeout:35000})));}
     catch(error){console.error('PHYSICAL_CONCURRENT_PRECOMMIT_RECOVERY_TRACE '+JSON.stringify({intent:[...intentSeen],registration:[...registrationSeen],completion:[...completionSeen],completionResults,trace:recoveryTrace,bodies:await Promise.all([page,peer].map(p=>p.locator('body').innerText()))}));throw error;}
     assert.equal(intentSeen.size,2);assert.equal(registrationSeen.size,2);assert.equal(completionSeen.size,2);
     assert.equal(completionResults.filter(r=>r.ok&&r.replayed===false).length,1);
     assert.ok(completionResults.some(r=>r.ok&&r.replayed===true));
     for(const p of [page,peer])await p.unrouteAll({behavior:'wait'});
    }else await signIn();
    try{await page.waitForFunction(id=>document.querySelector('[aria-label="Verified native movie"]')?.textContent===id,proof.projectId);}
    catch(error){console.error('PHYSICAL_REGISTRATION_RECOVERY_TRACE '+JSON.stringify({precommit:!!proof.precommit,trace:recoveryTrace,body:await page.locator('body').innerText()}));throw error;}
   assert.equal(await registrationIntents.countDocuments({ownerId}),0);
   assert.equal(await registrationCompletions.countDocuments({ownerId,projectId:proof.projectId}),1);
   assert.equal((await selection.read({token:owner,projectId:proof.vaultId})).activeProjectId,proof.projectId);
   assert.equal(await projects.countDocuments({ownerId}),proof.count+1);
   assert.equal(providerRequests.length,0);
   if(proof.precommit){
    assert.equal(await canonicalCreatorStates.countDocuments({projectId:proof.projectId}),1);
    assert.equal(await gate.states.countDocuments({projectId:proof.projectId}),1);
    assert.equal(await provenance.ledger.countDocuments({projectId:proof.projectId}),1);
    assert.equal(await provenance.ledger.countDocuments({projectId:proof.vaultId,operationId:'register:'+proof.projectId}),1);
    assert.equal(await registry.countDocuments({projectId:proof.projectId}),1);
    const selected=await selection.read({token:owner,projectId:proof.vaultId});
    assert.equal(selected.revision,proof.selectionBefore.revision+2);
    assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,proof.consumed);
    if(proof.concurrent){
     const vault=await gate.states.findOne({projectId:proof.vaultId,ownerId,revoked:false});
     assert.equal(vault.state.content.projects.filter(p=>p.id===proof.projectId&&p.ownerId===ownerId).length,1);
     const selectionSnapshot=await selection.read({token:owner,projectId:proof.vaultId});
     assert.equal((await transport({path:'/studio/native-registration-complete',token:owner,body:{projectId:proof.projectId}})).replayed,true);
     assert.equal((await transport({path:'/studio/native-registration-complete',token:foreign,body:{projectId:proof.projectId}})).ok,false);
     assert.equal((await transport({path:'/studio/read',token:foreign,body:{projectId:proof.projectId}})).ok,false);
     assert.equal((await transport({path:'/studio/native-execution-initiate',token:foreign,body:{projectId:proof.projectId,selectionVaultId:proof.vaultId}})).ok,false);
     assert.equal((await transport({path:'/studio/native-registration-complete',token:owner,body:{projectId:proof.previousSelection}})).ok,false);
     assert.deepEqual(await selection.read({token:owner,projectId:proof.vaultId}),selectionSnapshot);
     assert.equal(providerRequests.length,0);
     console.log('GREEN PHYSICAL_CONCURRENT_PRECOMMIT_BROWSER_PROVISIONING_AND_COMPLETION_REPLAY');
    }else console.log('GREEN PHYSICAL_PRECOMMIT_REGISTRATION_FRESH_PROCESS_EXACT_RETRY');
   }else console.log('GREEN PHYSICAL_INITIAL_PROVISIONING_FRESH_PROCESS_BROWSER_RECOVERY');
   const before=await projects.findOne({_id:proof.projectId});
   await entitlement.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
   await page.getByRole('button',{name:'Request native writing'}).click();await page.getByText('Server writer admitted',{exact:true}).waitFor();
   const region=page.getByLabel('Native cockpit conversation'),transcript=region.getByLabel('Committed conversation transcript'),message='Fresh process registration continuation '+randomUUID();
   await region.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(message);await region.getByRole('button',{name:'Send',exact:true}).click();await transcript.getByText(message,{exact:true}).waitFor({timeout:20000});
   const after=await projects.findOne({_id:proof.projectId});assert.equal(after.revision,before.revision+1);assert.equal(after.state.conversationMessages.at(-2).text,message);
   const executionRow=await mongoose.connection.db.collection('movie_mentor_inference_execution').findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:after.state.conversationMessages.at(-2).id,phase:'settled'});assert.ok(executionRow);
   const canonical=await composed.execution.authority.readCanonicalResult({executionId:executionRow.executionId});assert.equal(canonical.authorized,true);assert.equal(after.state.conversationMessages.at(-1).text,canonical.resultPayload.text);
   await signIn();await transcript.getByText(message,{exact:true}).waitFor({timeout:15000});
   assert.deepEqual(await projects.findOne({_id:proof.projectId}),after);
   assert.equal(await receipts.countDocuments({projectId:proof.projectId}),1);
   assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,proof.consumed+1);assert.equal(providerRequests.length,5);
   for(const prior of proof.prior){const actual=await projects.findOne({_id:prior.id});assert.equal(actual.revision,prior.revision);assert.deepEqual(actual.state,prior.state);}
   if(proof.concurrent){
    // The second independent browser must recover the first durable settlement,
    // then author its own turn without duplicating the first charge or receipt.
    await peerSignIn();
    const peerRegion=peer.getByLabel('Native cockpit conversation'),peerTranscript=peerRegion.getByLabel('Committed conversation transcript');
    await peerTranscript.getByText(message,{exact:true}).waitFor({timeout:15000});
    await entitlement.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
    await peer.getByRole('button',{name:'Request native writing'}).click();await peer.getByText('Server writer admitted',{exact:true}).waitFor();
    const peerMessage='Independent competing browser continuation '+randomUUID();
    await peerRegion.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(peerMessage);await peerRegion.getByRole('button',{name:'Send',exact:true}).click();await peerTranscript.getByText(peerMessage,{exact:true}).waitFor({timeout:20000});
    const final=await projects.findOne({_id:proof.projectId});assert.equal(final.revision,after.revision+1);assert.deepEqual(final.state.conversationMessages.slice(0,-2),after.state.conversationMessages);
    assert.equal(final.state.conversationMessages.at(-2).text,peerMessage);
    const peerExecution=await mongoose.connection.db.collection('movie_mentor_inference_execution').findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:final.state.conversationMessages.at(-2).id,phase:'settled'});
    assert.ok(peerExecution);const peerCanonical=await composed.execution.authority.readCanonicalResult({executionId:peerExecution.executionId});assert.equal(peerCanonical.authorized,true);assert.equal(final.state.conversationMessages.at(-1).text,peerCanonical.resultPayload.text);
    await Promise.all([signIn(),peerSignIn()]);
    for(const p of [page,peer]){const history=p.getByLabel('Committed conversation transcript');await history.getByText(message,{exact:true}).waitFor({timeout:15000});await history.getByText(peerMessage,{exact:true}).waitFor({timeout:15000});}
    assert.deepEqual(await projects.findOne({_id:proof.projectId}),final);
    assert.equal(await receipts.countDocuments({projectId:proof.projectId}),2);
    assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,proof.consumed+2);assert.equal(providerRequests.length,10);
    assert.equal(await registrationCompletions.countDocuments({ownerId,projectId:proof.projectId}),1);
    for(const prior of proof.prior){const actual=await projects.findOne({_id:prior.id});assert.equal(actual.revision,prior.revision);assert.deepEqual(actual.state,prior.state);}
    console.log('GREEN PHYSICAL_CONCURRENT_PRECOMMIT_BROWSER_DUAL_COMPOSER_SETTLEMENT_AND_RELOAD');
    // Compete on the same recovered movie after the certified sequential controls.
    const raceBefore=await projects.findOne({_id:proof.projectId});
    const raceBalance=await entitlement.findOne({principalId:ownerId});
    const raceCalls=providerRequests.length;
    const attempts=[],admissions=[];
    let releaseAdmission;const admissionBarrier=new Promise(r=>releaseAdmission=r);
    const admissionSeen=new Set();
    for(const [label,p] of [['A',page],['B',peer]]){
     await p.route('**/native-authority/studio/admit-publication',async route=>{
      admissionSeen.add(label);if(admissionSeen.size===2)releaseAdmission();await admissionBarrier;
      const response=await route.fetch(),body=await response.json();admissions.push({label,body,request:route.request().postDataJSON()});await route.fulfill({response});
     });
    }
    await Promise.all([page,peer].map(p=>p.getByRole('button',{name:'Request native writing'}).click()));
    const until=async(predicate,description)=>{const deadline=Date.now()+20000;while(!await predicate()){assert.ok(Date.now()<deadline,description);await new Promise(r=>setTimeout(r,100))}};
    await until(()=>admissions.length===2,'both genuine writer admission responses required');
    assert.equal(admissionSeen.size,2);
    for(const p of [page,peer])await p.unrouteAll({behavior:'wait'});
    const active=await gate.states.findOne({projectId:proof.projectId,ownerId,revoked:false});
    const authority=await gate.admissions.findOne({projectId:proof.projectId,ownerId,fence:active.activeWriterFence,status:'admitted'});
    assert.ok(authority);
    const enabled=[];
    for(const [label,p] of [['A',page],['B',peer]]){
     const composer=p.getByPlaceholder("Tell Movie Mentor what's on your mind...");
     if(await composer.isEnabled())enabled.push({label,p,composer,text:'Competing genuine creator '+label+' '+randomUUID()});
    }
    assert.ok(enabled.length>=1);
    console.log('PHYSICAL_WRITER_CONTENTION_EVIDENCE '+JSON.stringify({admissionRequests:admissionSeen.size,admissions:admissions.map(a=>({label:a.label,ok:a.body.ok,reason:a.body.reason,fence:a.body.fence??a.body.admission?.fence??null})),activeFence:authority.fence,enabled:['A','B'].map(label=>({label,enabled:enabled.some(x=>x.label===label)}))}));
    // If admission already denied one browser, keep that denial visible; do not manufacture a second writable UI.
    const staleId=randomUUID(),staleText='Rejected stale creator '+staleId;
    const stale={projectId:proof.projectId,selectionVaultId:proof.vaultId,operationId:authority.operationId+':'+staleId,creatorTurnId:staleId,expectedRevision:active.revision,fence:'stale-'+randomUUID(),creatorMessage:{id:staleId,role:'creator',text:staleText},requestDigest:buildRequestDigest({creatorMessage:staleText,projectId:proof.projectId,options:{}})};
    assert.equal((await transport({path:'/studio/native-execution-initiate',token:owner,body:stale})).ok,false);
    const forged={...stale,fence:authority.fence,mentorMessage:{id:'mentor-'+staleId,role:'mentor',text:'forged',metadata:{backendMetadata:{creatorTurnId:staleId}}}};
    assert.equal((await transport({path:'/studio/strict-conversation-settle',token:owner,body:forged})).ok,false);
    assert.equal(providerRequests.length,raceCalls);
    assert.deepEqual(await projects.findOne({_id:proof.projectId}),raceBefore);
    await entitlement.updateOne({principalId:ownerId},{$inc:{remainingUnits:2,entitlementRevision:1}});
    let releaseSend;const sendBarrier=new Promise(r=>releaseSend=r);const sendSeen=new Set();
    for(const x of enabled){
     await x.p.route('**/native-authority/studio/native-execution-initiate',async route=>{
      sendSeen.add(x.label);if(sendSeen.size===enabled.length)releaseSend();await sendBarrier;
      const input=route.request().postDataJSON(),response=await route.fetch(),body=await response.json();
      attempts.push({label:x.label,input,body});await route.fulfill({response});
     });
     await x.composer.fill(x.text);
    }
    await Promise.all(enabled.map(x=>x.p.getByRole('button',{name:'Send',exact:true}).click()));
    await until(()=>attempts.length===enabled.length,'all enabled genuine composer attempts returned');
    assert.equal(sendSeen.size,enabled.length);
    const winners=attempts.filter(x=>x.body.ok);assert.equal(winners.length,1);
    const winner=winners[0],winningPage=enabled.find(x=>x.label===winner.label);
    await winningPage.p.getByLabel('Committed conversation transcript').getByText(winningPage.text,{exact:true}).waitFor({timeout:20000});
    const raceAfter=await projects.findOne({_id:proof.projectId});
    assert.equal(raceAfter.revision,raceBefore.revision+1);
    assert.deepEqual(raceAfter.state.conversationMessages.slice(0,-2),raceBefore.state.conversationMessages);
    assert.equal(raceAfter.state.conversationMessages.at(-2).text,winningPage.text);
    assert.equal(await receipts.countDocuments({projectId:proof.projectId}),3);
    assert.equal(providerRequests.length,raceCalls+5);
    assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,raceBalance.consumedUnits+1);
    const raceExecutions=mongoose.connection.db.collection('movie_mentor_inference_execution');
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),3);
    const raceRow=await raceExecutions.findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:winner.input.creatorTurnId,phase:'settled'});
    assert.ok(raceRow);const raceCanonical=await composed.execution.authority.readCanonicalResult({executionId:raceRow.executionId});
    assert.equal(raceCanonical.authorized,true);assert.equal(raceAfter.state.conversationMessages.at(-1).text,raceCanonical.resultPayload.text);
    for(const x of attempts.filter(x=>!x.body.ok)){
     assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId,creatorTurnId:x.input.creatorTurnId}),0);
     assert.equal((await transport({path:'/studio/native-execution-initiate',token:owner,body:x.input})).ok,false);
    }
    for(const p of [page,peer])await p.unrouteAll({behavior:'wait'});
    console.log('PHYSICAL_COMPOSER_CONTENTION_EVIDENCE '+JSON.stringify({requests:attempts.length,attempts:attempts.map(a=>({label:a.label,fence:a.input.fence,creatorTurnId:a.input.creatorTurnId,ok:a.body.ok,reason:a.body.reason})),providerEffects:providerRequests.length-raceCalls,receipts:await receipts.countDocuments({projectId:proof.projectId}),charges:(await entitlement.findOne({principalId:ownerId})).consumedUnits-raceBalance.consumedUnits}));
    console.log('GREEN PHYSICAL_RECOVERED_BROWSER_WRITER_ADMISSION_CONTENTION_AND_CANONICAL_FENCING');
    const loser=winner.label==='A'?peer:page,loserSignIn=winner.label==='A'?peerSignIn:signIn;
    await loserSignIn();const loserHistory=loser.getByLabel('Committed conversation transcript');
    await loserHistory.getByText(winningPage.text,{exact:true}).waitFor({timeout:15000});
    await loser.getByRole('button',{name:'Request native writing'}).click();await loser.getByText('Server writer admitted',{exact:true}).waitFor();
    const retryText=enabled.find(x=>x.label!==winner.label)?.text||'Recovered competing creator retry '+randomUUID();
    await loser.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(retryText);
    await loser.getByRole('button',{name:'Send',exact:true}).click();await loserHistory.getByText(retryText,{exact:true}).waitFor({timeout:20000});
    const converged=await projects.findOne({_id:proof.projectId});
    assert.equal(converged.revision,raceAfter.revision+1);
    assert.deepEqual(converged.state.conversationMessages.slice(0,-2),raceAfter.state.conversationMessages);
    assert.equal(converged.state.conversationMessages.at(-2).text,retryText);
    assert.equal(await receipts.countDocuments({projectId:proof.projectId}),4);
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),4);
    assert.equal(providerRequests.length,raceCalls+10);
    assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,raceBalance.consumedUnits+2);
    await Promise.all([signIn(),peerSignIn()]);
    for(const p of [page,peer])for(const txt of [message,peerMessage,winningPage.text,retryText])await p.getByLabel('Committed conversation transcript').getByText(txt,{exact:true}).waitFor({timeout:15000});
    assert.deepEqual(await projects.findOne({_id:proof.projectId}),converged);
    for(const prior of proof.prior){const actual=await projects.findOne({_id:prior.id});assert.equal(actual.revision,prior.revision);assert.deepEqual(actual.state,prior.state);}
    console.log('GREEN PHYSICAL_RECOVERED_BROWSER_COMPOSER_CONTENTION_RETRY_ACCOUNTING_AND_RELOAD');
    // Independent deterministic race: hold A's real execution request before ingress,
    // admit B from a fresh read, then release both captured requests together.
    const deterministicBefore=await projects.findOne({_id:proof.projectId});
    const deterministicBalance=await entitlement.findOne({principalId:ownerId});
    const deterministicCalls=providerRequests.length;
    await entitlement.updateOne({principalId:ownerId},{$inc:{remainingUnits:2,entitlementRevision:1}});
    await page.getByRole('button',{name:'Request native writing'}).click();
    await page.getByText('Server writer admitted',{exact:true}).waitFor();
    const originalAuthority=await gate.states.findOne({projectId:proof.projectId,ownerId,revoked:false});
    const captured=[],outcomes=[];
    let releaseBoth;const bothReady=new Promise(r=>releaseBoth=r);
    let firstCaptured;const firstReady=new Promise(r=>firstCaptured=r);
    for(const [label,p] of [['A',page],['B',peer]]){
     await p.route('**/native-authority/studio/native-execution-initiate',async route=>{
      const input=route.request().postDataJSON();
      captured.push({label,input});
      if(label==='A')firstCaptured();
      if(captured.length===2)releaseBoth();
      await bothReady;
      const response=await route.fetch(),body=await response.json();
      outcomes.push({label,ok:body.ok,reason:body.reason});
      await route.fulfill({response});
     });
    }
    const aText='Deterministic stale creator '+randomUUID(),bText='Deterministic current creator '+randomUUID();
    await page.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(aText);
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await Promise.race([firstReady,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('first genuine execution request not captured')),15000);t.unref()})]);
    assert.equal(captured[0].input.fence,originalAuthority.activeWriterFence);
    // A remains paused before server ingress. Explicitly retire its unbound
    // writer through the existing authenticated cancellation contract.
    const cancellationSelection=await selection.read({token:owner,projectId:proof.vaultId});
    const cancellation={projectId:proof.projectId,selectionVaultId:proof.vaultId,expectedRevision:captured[0].input.expectedRevision,expectedSelectionRevision:cancellationSelection.revision,confirmCancellation:true};
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId,creatorTurnId:captured[0].input.creatorTurnId}),0);
    const beforeCancellationBalance=await entitlement.findOne({principalId:ownerId});
    assert.equal((await transport({path:'/studio/native-conversation-cancel',token:foreign,body:cancellation})).ok,false);
    const cancelled=await transport({path:'/studio/native-conversation-cancel',token:owner,body:cancellation});
    assert.equal(cancelled.ok,true,JSON.stringify(cancelled));
    assert.equal(cancelled.cancelled,true);
    assert.equal(cancelled.projectId,proof.projectId);
    assert.equal(cancelled.revision,cancellation.expectedRevision);
    const cancelledState=await gate.states.findOne({projectId:proof.projectId,ownerId,revoked:false});
    assert.equal(cancelledState.activeWriterFence,undefined);
    assert.equal(cancelledState.activeAdoptionGrant,undefined);
    assert.equal(cancelledState.revision,cancellation.expectedRevision);
    const retired=await gate.admissions.findOne({projectId:proof.projectId,ownerId,fence:originalAuthority.activeWriterFence});
    assert.equal(retired.status,'retired');
    assert.equal(retired.retirementReason,'explicit-uncommitted-conversation-cancellation');
    assert.deepEqual(await projects.findOne({_id:proof.projectId}),deterministicBefore);
    assert.deepEqual(await entitlement.findOne({principalId:ownerId}),beforeCancellationBalance);
    assert.equal(await receipts.countDocuments({projectId:proof.projectId}),4);
    assert.equal(providerRequests.length,deterministicCalls);
    console.log('PHYSICAL_CAPTURED_WRITER_CANCELLATION_EVIDENCE '+JSON.stringify({retiredFence:retired.fence,reason:retired.retirementReason,capturedRequests:captured.length,providerEffects:0,receipts:4}));
    await peerSignIn();
    await peer.getByRole('button',{name:'Request native writing'}).click();
    await peer.getByText('Server writer admitted',{exact:true}).waitFor({timeout:15000});
    const currentAuthority=await gate.states.findOne({projectId:proof.projectId,ownerId,revoked:false});
    assert.notEqual(currentAuthority.activeWriterFence,originalAuthority.activeWriterFence);
    await peer.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(bText);
    await peer.getByRole('button',{name:'Send',exact:true}).click();
    await until(()=>outcomes.length===2,'two actual captured execution requests must return');
    assert.equal(captured.length,2);
    assert.equal(captured.find(x=>x.label==='B').input.fence,currentAuthority.activeWriterFence);
    assert.equal(outcomes.find(x=>x.label==='A').ok,false);
    assert.equal(outcomes.find(x=>x.label==='B').ok,true);
    await peer.getByLabel('Committed conversation transcript').getByText(bText,{exact:true}).waitFor({timeout:20000});
    const deterministicAfter=await projects.findOne({_id:proof.projectId});
    assert.equal(deterministicAfter.revision,deterministicBefore.revision+1);
    assert.deepEqual(deterministicAfter.state.conversationMessages.slice(0,-2),deterministicBefore.state.conversationMessages);
    assert.equal(deterministicAfter.state.conversationMessages.at(-2).text,bText);
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId,creatorTurnId:captured[0].input.creatorTurnId}),0);
    const bRow=await raceExecutions.findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:captured.find(x=>x.label==='B').input.creatorTurnId,phase:'settled'});
    assert.ok(bRow);const bCanonical=await composed.execution.authority.readCanonicalResult({executionId:bRow.executionId});
    assert.equal(bCanonical.authorized,true);assert.equal(deterministicAfter.state.conversationMessages.at(-1).text,bCanonical.resultPayload.text);
    assert.equal(providerRequests.length,deterministicCalls+5);
    assert.equal(await receipts.countDocuments({projectId:proof.projectId}),5);
    assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,deterministicBalance.consumedUnits+1);
    console.log('PHYSICAL_TWO_EXECUTION_REQUEST_EVIDENCE '+JSON.stringify({requests:captured.map(x=>({label:x.label,fence:x.input.fence,turn:x.input.creatorTurnId})),outcomes,providerEffects:providerRequests.length-deterministicCalls,receipts:5,charges:1}));
    console.log('GREEN PHYSICAL_DETERMINISTIC_TWO_BROWSER_EXECUTION_CONTENTION');
    for(const p of [page,peer])await p.unrouteAll({behavior:'wait'});
    await signIn();await page.getByLabel('Committed conversation transcript').getByText(bText,{exact:true}).waitFor({timeout:15000});
    await page.getByRole('button',{name:'Request native writing'}).click();await page.getByText('Server writer admitted',{exact:true}).waitFor();
    await page.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(aText);
    await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByLabel('Committed conversation transcript').getByText(aText,{exact:true}).waitFor({timeout:20000});
    const deterministicFinal=await projects.findOne({_id:proof.projectId});
    assert.equal(deterministicFinal.revision,deterministicAfter.revision+1);
    assert.deepEqual(deterministicFinal.state.conversationMessages.slice(0,-2),deterministicAfter.state.conversationMessages);
    assert.equal(deterministicFinal.state.conversationMessages.at(-2).text,aText);
    const aRow=await raceExecutions.findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:deterministicFinal.state.conversationMessages.at(-2).id,phase:'settled'});
    assert.ok(aRow);const aCanonical=await composed.execution.authority.readCanonicalResult({executionId:aRow.executionId});
    assert.equal(aCanonical.authorized,true);assert.equal(deterministicFinal.state.conversationMessages.at(-1).text,aCanonical.resultPayload.text);
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),6);
    assert.equal(await receipts.countDocuments({projectId:proof.projectId}),6);
    assert.equal(providerRequests.length,deterministicCalls+10);
    assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,deterministicBalance.consumedUnits+2);
    await Promise.all([signIn(),peerSignIn()]);
    for(const p of [page,peer])for(const txt of [message,peerMessage,winningPage.text,retryText,bText,aText])await p.getByLabel('Committed conversation transcript').getByText(txt,{exact:true}).waitFor({timeout:15000});
    assert.deepEqual(await projects.findOne({_id:proof.projectId}),deterministicFinal);
    for(const prior of proof.prior){const actual=await projects.findOne({_id:prior.id});assert.equal(actual.revision,prior.revision);assert.deepEqual(actual.state,prior.state);}
    console.log('GREEN PHYSICAL_DETERMINISTIC_STALE_BROWSER_RETRY_CANONICAL_CONVERGENCE');
    // Independent fresh writer epochs: cancellation first, binding first,
    // then actual overlapping HTTP cancellation and initiation.
    const arbitrationHistory=[message,peerMessage,winningPage.text,retryText,bText,aText];
    const bindingRows=db.collection('native_execution_initiation_bindings');
    for(const order of ['cancel-first','bind-first','concurrent']){
     await signIn();
     const priorProject=await projects.findOne({_id:proof.projectId});
     const priorReceipts=await receipts.countDocuments({projectId:proof.projectId});
     const priorExecutions=await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId});
     const priorBindings=await bindingRows.countDocuments({ownerId,projectId:proof.projectId});
     const priorCalls=providerRequests.length;
     const priorConsumed=(await entitlement.findOne({principalId:ownerId})).consumedUnits;
     await entitlement.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
     await page.getByRole('button',{name:'Request native writing'}).click();
     await page.getByText('Server writer admitted',{exact:true}).waitFor({timeout:15000});
     const arbitrationText='Cancellation initiation '+order+' '+randomUUID();
     let notifyCapture,releaseCapture;const captureReady=new Promise(r=>notifyCapture=r),captureGate=new Promise(r=>releaseCapture=r);
     await page.route('**/native-authority/studio/native-execution-initiate',async route=>{
      notifyCapture(route.request().postDataJSON());
      await captureGate;
      // The exact genuine request is dispatched once by the arbitration court;
      // browser acknowledgement is deliberately withheld until realm reload.
      await route.abort();
     });
     await page.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(arbitrationText);
     await page.getByRole('button',{name:'Send',exact:true}).click();
     const input=await Promise.race([captureReady,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('arbitration genuine capture timeout')),15000);t.unref()})]);
     const selected=await selection.read({token:owner,projectId:proof.vaultId});
     const cancel={projectId:proof.projectId,selectionVaultId:proof.vaultId,expectedRevision:input.expectedRevision,expectedSelectionRevision:selected.revision,confirmCancellation:true};
     const initiate=()=>transport({path:'/studio/native-execution-initiate',token:owner,body:input});
     const cancelRequest=()=>transport({path:'/studio/native-conversation-cancel',token:owner,body:cancel});
     assert.equal((await transport({path:'/studio/native-conversation-cancel',token:foreign,body:cancel})).ok,false);
     let executionResult,cancelResult;
     if(order==='cancel-first'){cancelResult=await cancelRequest();executionResult=await initiate();assert.equal(cancelResult.ok,true);assert.equal(executionResult.ok,false);}
     else if(order==='bind-first'){executionResult=await initiate();cancelResult=await cancelRequest();assert.equal(executionResult.ok,true);assert.equal(cancelResult.ok,false);}
     else [cancelResult,executionResult]=await Promise.all([cancelRequest(),initiate()]);
     assert.equal(Number(cancelResult.ok===true)+Number(executionResult.ok===true),1,'exactly one authority may win');
     assert.deepEqual(await projects.findOne({_id:proof.projectId}),priorProject);
     assert.equal(await receipts.countDocuments({projectId:proof.projectId}),priorReceipts);
     const bound=executionResult.ok===true;
     assert.equal(await bindingRows.countDocuments({ownerId,projectId:proof.projectId}),priorBindings+Number(bound));
     assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),priorExecutions+Number(bound));
     assert.equal(providerRequests.length,priorCalls+(bound?5:0));
     assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,priorConsumed+Number(bound));
     if(bound){
      assert.equal((await cancelRequest()).ok,false);
      const row=await raceExecutions.findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:input.creatorTurnId});
      assert.ok(row);const result=await composed.execution.authority.readCanonicalResult({executionId:row.executionId});
      assert.equal(result.authorized,true);assert.equal(executionResult.mentorMessage.text,result.resultPayload.text);
     }else{
      const retired=await gate.admissions.findOne({projectId:proof.projectId,ownerId,fence:input.fence});
      assert.equal(retired.status,'retired');assert.equal(retired.retirementReason,'explicit-uncommitted-conversation-cancellation');
      assert.equal((await initiate()).ok,false);
     }
     console.log('PHYSICAL_CANCELLATION_INITIATION_ARBITRATION_EVIDENCE '+JSON.stringify({order,turn:input.creatorTurnId,fence:input.fence,cancelled:cancelResult.ok===true,bound,providerEffects:providerRequests.length-priorCalls,charges:(await entitlement.findOne({principalId:ownerId})).consumedUnits-priorConsumed}));
     // Destroy the original browser page before permitting its held request
     // to complete, so recovery must come from durable server authority.
     const closing=page.goto('about:blank');releaseCapture();await closing;
     await page.unrouteAll({behavior:'wait'});
     await peerSignIn();
     const history=peer.getByLabel('Committed conversation transcript');
     if(!bound){
      await peer.getByRole('button',{name:'Request native writing'}).click();await peer.getByText('Server writer admitted',{exact:true}).waitFor({timeout:15000});
      await peer.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(arbitrationText);
      await peer.getByRole('button',{name:'Send',exact:true}).click();
     }
     await history.getByText(arbitrationText,{exact:true}).waitFor({timeout:20000});
     const settled=await projects.findOne({_id:proof.projectId});
     assert.equal(settled.revision,priorProject.revision+1);
     assert.deepEqual(settled.state.conversationMessages.slice(0,-2),priorProject.state.conversationMessages);
     assert.equal(settled.state.conversationMessages.at(-2).text,arbitrationText);
     if(bound)assert.equal(settled.state.conversationMessages.at(-2).id,input.creatorTurnId);
     const settledRow=await raceExecutions.findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:settled.state.conversationMessages.at(-2).id,phase:'settled'});
     assert.ok(settledRow);const settledCanonical=await composed.execution.authority.readCanonicalResult({executionId:settledRow.executionId});
     assert.equal(settledCanonical.authorized,true);assert.equal(settled.state.conversationMessages.at(-1).text,settledCanonical.resultPayload.text);
     assert.equal(await receipts.countDocuments({projectId:proof.projectId}),priorReceipts+1);
     assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),priorExecutions+1);
     assert.equal(await bindingRows.countDocuments({ownerId,projectId:proof.projectId}),priorBindings+1);
     assert.equal(providerRequests.length,priorCalls+5);
     assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,priorConsumed+1);
     arbitrationHistory.push(arbitrationText);
     await Promise.all([signIn(),peerSignIn()]);
     for(const p of [page,peer])for(const txt of arbitrationHistory)await p.getByLabel('Committed conversation transcript').getByText(txt,{exact:true}).waitFor({timeout:15000});
     assert.deepEqual(await projects.findOne({_id:proof.projectId}),settled);
     for(const prior of proof.prior){const actual=await projects.findOne({_id:prior.id});assert.equal(actual.revision,prior.revision);assert.deepEqual(actual.state,prior.state);}
     console.log('GREEN '+({'cancel-first':'PHYSICAL_CANCEL_FIRST_INITIATION_DENIAL_AND_RETRY','bind-first':'PHYSICAL_BIND_FIRST_CANCELLATION_DENIAL_AND_DURABLE_RECOVERY','concurrent':'PHYSICAL_CONCURRENT_CANCELLATION_INITIATION_ARBITRATION_AND_CONVERGENCE'})[order]);
    }
    // New physical court: genuine browser request, independent binding worker,
    // actual SIGKILL after majority commit, then recovery on a separate server.
    await signIn();
    const killBefore=await projects.findOne({_id:proof.projectId});
    const killReceipts=await receipts.countDocuments({projectId:proof.projectId});
    const killExecutions=await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId});
    const killBindings=await bindingRows.countDocuments({ownerId,projectId:proof.projectId});
    const killCalls=providerRequests.length;
    await entitlement.updateOne({principalId:ownerId},{$inc:{remainingUnits:2,entitlementRevision:1}});
    const killBalance=await entitlement.findOne({principalId:ownerId});
    await page.getByRole('button',{name:'Request native writing'}).click();
    await page.getByText('Server writer admitted',{exact:true}).waitFor({timeout:15000});
    const killText='Durable binding before dispatch '+randomUUID();
    const workerManifest='./native-bound-worker-'+randomUUID()+'.json',pauseManifest=workerManifest+'.pause';
    const workerEnv={...process.env,NATIVE_BOUND_WORKER_MANIFEST:workerManifest,NATIVE_BOUND_WORKER_PAUSE:pauseManifest};
    delete workerEnv.NATIVE_INITIAL_PROVISION_RECOVERY;
    const worker=spawn(process.execPath,['./verify-physical-native-film-registration.mjs'],{env:workerEnv,stdio:['ignore','pipe','pipe']});
    let workerOutput='';worker.stdout.on('data',x=>workerOutput+=x);worker.stderr.on('data',x=>workerOutput+=x);
    const workerExit=new Promise(resolve=>worker.once('close',(status,signal)=>resolve({status,signal})));
    let captureKill;const killCapture=new Promise(r=>captureKill=r);
    const readWorkerSignal=async(path)=>{for(let i=0;i<200;i++){try{return JSON.parse(readFileSync(path,'utf8'))}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('binding worker signal missing '+workerOutput)};
    let killInput;
    try{
     const address=await readWorkerSignal(workerManifest);assert.equal(address.pid,worker.pid);
     let releaseRoute;const heldRoute=new Promise(r=>releaseRoute=r);
     await page.route('**/native-authority/studio/native-execution-initiate',async route=>{
      captureKill(route.request().postDataJSON());
      await heldRoute;
      await route.abort().catch(()=>{});
     });
     await page.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(killText);
     await page.getByRole('button',{name:'Send',exact:true}).click();
     killInput=await Promise.race([killCapture,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('binding SIGKILL capture timeout')),15000);t.unref()})]);
     const request=fetch('http://127.0.0.1:'+address.port+'/studio/native-execution-initiate',{method:'POST',headers:{authorization:'Bearer '+owner,'content-type':'application/json'},body:JSON.stringify(killInput)}).then(()=>false,()=>true);
     const paused=await readWorkerSignal(pauseManifest);
     assert.equal(paused.pid,worker.pid);assert.equal(paused.creatorTurnId,killInput.creatorTurnId);assert.equal(paused.fence,killInput.fence);
     const binding=await bindingRows.findOne({ownerId,projectId:proof.projectId,creatorTurnId:killInput.creatorTurnId});
     assert.ok(binding);assert.equal(binding.creatorText,killText);assert.equal(binding.requestDigest,killInput.requestDigest);assert.equal(binding.fence,killInput.fence);
     assert.equal(await bindingRows.countDocuments({ownerId,projectId:proof.projectId}),killBindings+1);
     assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),killExecutions);
     assert.deepEqual(await entitlement.findOne({principalId:ownerId}),killBalance);
     assert.deepEqual(await projects.findOne({_id:proof.projectId}),killBefore);
     assert.equal(await receipts.countDocuments({projectId:proof.projectId}),killReceipts);
     worker.kill('SIGKILL');assert.equal((await workerExit).signal,'SIGKILL');assert.equal(await request,true);
     assert.deepEqual(await bindingRows.findOne({ownerId,projectId:proof.projectId,creatorTurnId:killInput.creatorTurnId}),binding);
     assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),killExecutions);
     assert.deepEqual(await entitlement.findOne({principalId:ownerId}),killBalance);
     assert.equal(providerRequests.length,killCalls);
     console.log('PHYSICAL_BOUND_PRE_DISPATCH_SIGKILL_EVIDENCE '+JSON.stringify({workerPid:worker.pid,recoveryPid:process.pid,signal:'SIGKILL',turn:killInput.creatorTurnId,fence:killInput.fence,providerEffects:0,charges:0}));
     console.log('GREEN PHYSICAL_DURABLE_BINDING_PRE_DISPATCH_SIGKILL');
     const blank=page.goto('about:blank');releaseRoute();await blank;await page.unrouteAll({behavior:'wait'});
    }finally{if(worker.exitCode===null&&worker.signalCode===null)worker.kill('SIGKILL');await workerExit;for(const f of [workerManifest,pauseManifest])try{unlinkSync(f)}catch{}}
    const killSelection=await selection.read({token:owner,projectId:proof.vaultId});
    const killCancel={projectId:proof.projectId,selectionVaultId:proof.vaultId,expectedRevision:killInput.expectedRevision,expectedSelectionRevision:killSelection.revision,confirmCancellation:true};
    assert.equal((await transport({path:'/studio/native-conversation-cancel',token:owner,body:killCancel})).ok,false);
    assert.equal((await transport({path:'/studio/native-execution-initiate',token:foreign,body:killInput})).ok,false);
    // Do not manually resubmit the captured payload: fresh authenticated
    // browsers must recover the durable creator identity themselves.
    await Promise.all([signIn(),peerSignIn()]);
    try{await Promise.all([page,peer].map(p=>p.getByLabel('Committed conversation transcript').getByText(killText,{exact:true}).waitFor({timeout:20000})));}
    catch(error){console.error('PHYSICAL_BOUND_PRE_DISPATCH_RECOVERY_TRACE '+JSON.stringify({turn:killInput.creatorTurnId,trace:recoveryTrace,bodies:await Promise.all([page,peer].map(p=>p.locator('body').innerText())),executions:await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),providerEffects:providerRequests.length-killCalls}));throw error;}
    const killAfter=await projects.findOne({_id:proof.projectId});
    assert.equal(killAfter.revision,killBefore.revision+1);
    assert.deepEqual(killAfter.state.conversationMessages.slice(0,-2),killBefore.state.conversationMessages);
    assert.equal(killAfter.state.conversationMessages.at(-2).id,killInput.creatorTurnId);
    assert.equal(killAfter.state.conversationMessages.at(-2).text,killText);
    const killRow=await raceExecutions.findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:killInput.creatorTurnId,phase:'settled'});
    assert.ok(killRow);const killCanonical=await composed.execution.authority.readCanonicalResult({executionId:killRow.executionId});
    assert.equal(killCanonical.authorized,true);assert.equal(killAfter.state.conversationMessages.at(-1).text,killCanonical.resultPayload.text);
    assert.equal(await receipts.countDocuments({projectId:proof.projectId}),killReceipts+1);
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),killExecutions+1);
    assert.equal(await bindingRows.countDocuments({ownerId,projectId:proof.projectId}),killBindings+1);
    assert.equal(providerRequests.length,killCalls+5);
    assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,killBalance.consumedUnits+1);
    console.log('GREEN PHYSICAL_BOUND_PRE_DISPATCH_CONCURRENT_BROWSER_RECOVERY');
    await peer.getByRole('button',{name:'Request native writing'}).click();await peer.getByText('Server writer admitted',{exact:true}).waitFor({timeout:15000});
    const continuation='After binding worker SIGKILL '+randomUUID();
    await peer.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(continuation);
    await peer.getByRole('button',{name:'Send',exact:true}).click();await peer.getByLabel('Committed conversation transcript').getByText(continuation,{exact:true}).waitFor({timeout:20000});
    const killFinal=await projects.findOne({_id:proof.projectId});assert.equal(killFinal.revision,killAfter.revision+1);assert.deepEqual(killFinal.state.conversationMessages.slice(0,-2),killAfter.state.conversationMessages);
    assert.equal(killFinal.state.conversationMessages.at(-2).text,continuation);
    const continuedRow=await raceExecutions.findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:killFinal.state.conversationMessages.at(-2).id,phase:'settled'});
    assert.ok(continuedRow);const continuedCanonical=await composed.execution.authority.readCanonicalResult({executionId:continuedRow.executionId});
    assert.equal(continuedCanonical.authorized,true);assert.equal(killFinal.state.conversationMessages.at(-1).text,continuedCanonical.resultPayload.text);
    await Promise.all([signIn(),peerSignIn()]);
    for(const p of [page,peer])for(const txt of [...arbitrationHistory,killText,continuation])await p.getByLabel('Committed conversation transcript').getByText(txt,{exact:true}).waitFor({timeout:15000});
    assert.deepEqual(await projects.findOne({_id:proof.projectId}),killFinal);
    assert.equal(await receipts.countDocuments({projectId:proof.projectId}),killReceipts+2);
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),killExecutions+2);
    assert.equal(providerRequests.length,killCalls+10);
    assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,killBalance.consumedUnits+2);
    for(const prior of proof.prior){const actual=await projects.findOne({_id:prior.id});assert.equal(actual.revision,prior.revision);assert.deepEqual(actual.state,prior.state);}
    console.log('GREEN PHYSICAL_BOUND_PRE_DISPATCH_BROWSER_CONTINUATION_AND_RELOAD');
    {
    // Separate worker executes and settles the paid canonical turn before SIGKILL.
    // No publication or acknowledgement can occur before the kill.
    await signIn();
    const killBefore=await projects.findOne({_id:proof.projectId});
    const killReceipts=await receipts.countDocuments({projectId:proof.projectId});
    const killExecutions=await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId});
    const killBindings=await bindingRows.countDocuments({ownerId,projectId:proof.projectId});
    const killCalls=providerRequests.length;
    await entitlement.updateOne({principalId:ownerId},{$inc:{remainingUnits:2,entitlementRevision:1}});
    const killBalance=await entitlement.findOne({principalId:ownerId});
    await page.getByRole('button',{name:'Request native writing'}).click();
    await page.getByText('Server writer admitted',{exact:true}).waitFor({timeout:15000});
    const killText='Canonical settlement before publication '+randomUUID();
    const workerManifest='./native-bound-worker-'+randomUUID()+'.json',pauseManifest=workerManifest+'.pause';
    const workerEnv={...process.env,NATIVE_BOUND_WORKER_MANIFEST:workerManifest,NATIVE_BOUND_WORKER_PAUSE:pauseManifest,NATIVE_BOUND_WORKER_SETTLED:'1'};
    delete workerEnv.NATIVE_INITIAL_PROVISION_RECOVERY;
    const worker=spawn(process.execPath,['./verify-physical-native-film-registration.mjs'],{env:workerEnv,stdio:['ignore','pipe','pipe']});
    let workerOutput='';worker.stdout.on('data',x=>workerOutput+=x);worker.stderr.on('data',x=>workerOutput+=x);
    const workerExit=new Promise(resolve=>worker.once('close',(status,signal)=>resolve({status,signal})));
    let captureKill;const killCapture=new Promise(r=>captureKill=r);
    const readWorkerSignal=async(path)=>{for(let i=0;i<200;i++){try{return JSON.parse(readFileSync(path,'utf8'))}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('binding worker signal missing '+workerOutput)};
    let killInput,settledBeforeKill,canonicalBeforeKill,balanceBeforeKill;
    try{
     const address=await readWorkerSignal(workerManifest);assert.equal(address.pid,worker.pid);
     let releaseRoute;const heldRoute=new Promise(r=>releaseRoute=r);
     await page.route('**/native-authority/studio/native-execution-initiate',async route=>{
      captureKill(route.request().postDataJSON());
      await heldRoute;
      await route.abort().catch(()=>{});
     });
     await page.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(killText);
     await page.getByRole('button',{name:'Send',exact:true}).click();
     killInput=await Promise.race([killCapture,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('binding SIGKILL capture timeout')),15000);t.unref()})]);
     const request=fetch('http://127.0.0.1:'+address.port+'/studio/native-execution-initiate',{method:'POST',headers:{authorization:'Bearer '+owner,'content-type':'application/json'},body:JSON.stringify(killInput)}).then(()=>false,()=>true);
     const paused=await readWorkerSignal(pauseManifest);
     assert.equal(paused.pid,worker.pid);assert.equal(paused.creatorTurnId,killInput.creatorTurnId);assert.equal(paused.fence,killInput.fence);
     const binding=await bindingRows.findOne({ownerId,projectId:proof.projectId,creatorTurnId:killInput.creatorTurnId});
     assert.ok(binding);assert.equal(binding.creatorText,killText);assert.equal(binding.requestDigest,killInput.requestDigest);assert.equal(binding.fence,killInput.fence);
     assert.equal(await bindingRows.countDocuments({ownerId,projectId:proof.projectId}),killBindings+1);
     assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),killExecutions+1);
     settledBeforeKill=await raceExecutions.findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:killInput.creatorTurnId,phase:'settled'});
     assert.ok(settledBeforeKill);
     canonicalBeforeKill=await composed.execution.authority.readCanonicalResult({executionId:settledBeforeKill.executionId});
     assert.equal(canonicalBeforeKill.authorized,true);assert.equal(canonicalBeforeKill.committed,true);
     assert.equal(canonicalBeforeKill.resultPayload.text,paused.mentorMessage.text);
     const reconciler=createMovieMentorInferenceSettlementReconciliationAuthority({store:createMovieMentorInferenceSettlementMongoStore()});
     const reconciled=await reconciler.reconcile({executionId:settledBeforeKill.executionId});
     assert.equal(reconciled.authorized,true);assert.equal(reconciled.settled,true);assert.equal(reconciled.outcome,'consumed');
     assert.equal(reconciled.resultDigest,canonicalBeforeKill.resultDigest);
     balanceBeforeKill=await entitlement.findOne({principalId:ownerId});
     assert.equal(balanceBeforeKill.consumedUnits,killBalance.consumedUnits+1);
     assert.deepEqual(await projects.findOne({_id:proof.projectId}),killBefore);
     assert.equal(await receipts.countDocuments({projectId:proof.projectId}),killReceipts);
     worker.kill('SIGKILL');assert.equal((await workerExit).signal,'SIGKILL');assert.equal(await request,true);
     assert.deepEqual(await bindingRows.findOne({ownerId,projectId:proof.projectId,creatorTurnId:killInput.creatorTurnId}),binding);
     assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),killExecutions+1);
     assert.deepEqual(await raceExecutions.findOne({executionId:settledBeforeKill.executionId}),settledBeforeKill);
     assert.deepEqual(await entitlement.findOne({principalId:ownerId}),balanceBeforeKill);
     assert.deepEqual(await projects.findOne({_id:proof.projectId}),killBefore);
     assert.equal(await receipts.countDocuments({projectId:proof.projectId}),killReceipts);
     assert.equal(providerRequests.length,killCalls);
     console.log('PHYSICAL_SETTLED_PRE_PUBLICATION_SIGKILL_EVIDENCE '+JSON.stringify({workerPid:worker.pid,recoveryPid:process.pid,signal:'SIGKILL',turn:killInput.creatorTurnId,fence:killInput.fence,workerProviderEffects:5,recoveryProviderEffects:0,charges:1,publicationReceipts:0,executionId:settledBeforeKill.executionId,resultDigest:canonicalBeforeKill.resultDigest}));
     console.log('GREEN PHYSICAL_DURABLE_SETTLEMENT_PRE_PUBLICATION_SIGKILL');
     const blank=page.goto('about:blank');releaseRoute();await blank;await page.unrouteAll({behavior:'wait'});
    }finally{if(worker.exitCode===null&&worker.signalCode===null)worker.kill('SIGKILL');await workerExit;for(const f of [workerManifest,pauseManifest])try{unlinkSync(f)}catch{}}
    const killSelection=await selection.read({token:owner,projectId:proof.vaultId});
    const killCancel={projectId:proof.projectId,selectionVaultId:proof.vaultId,expectedRevision:killInput.expectedRevision,expectedSelectionRevision:killSelection.revision,confirmCancellation:true};
    assert.equal((await transport({path:'/studio/native-conversation-cancel',token:owner,body:killCancel})).ok,false);
    assert.equal((await transport({path:'/studio/native-execution-initiate',token:foreign,body:killInput})).ok,false);
    // Do not manually resubmit the captured payload: fresh authenticated
    // browsers must recover the durable creator identity themselves.
    await Promise.all([signIn(),peerSignIn()]);
    try{await Promise.all([page,peer].map(p=>p.getByLabel('Committed conversation transcript').getByText(killText,{exact:true}).waitFor({timeout:20000})));}
    catch(error){console.error('PHYSICAL_SETTLED_PRE_PUBLICATION_RECOVERY_TRACE '+JSON.stringify({turn:killInput.creatorTurnId,trace:recoveryTrace,bodies:await Promise.all([page,peer].map(p=>p.locator('body').innerText())),executions:await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),providerEffects:providerRequests.length-killCalls}));throw error;}
    const killAfter=await projects.findOne({_id:proof.projectId});
    assert.equal(killAfter.revision,killBefore.revision+1);
    assert.deepEqual(killAfter.state.conversationMessages.slice(0,-2),killBefore.state.conversationMessages);
    assert.equal(killAfter.state.conversationMessages.at(-2).id,killInput.creatorTurnId);
    assert.equal(killAfter.state.conversationMessages.at(-2).text,killText);
    const killRow=await raceExecutions.findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:killInput.creatorTurnId,phase:'settled'});
    assert.ok(killRow);const killCanonical=await composed.execution.authority.readCanonicalResult({executionId:killRow.executionId});
    assert.equal(killCanonical.authorized,true);assert.equal(killAfter.state.conversationMessages.at(-1).text,killCanonical.resultPayload.text);
    assert.equal(await receipts.countDocuments({projectId:proof.projectId}),killReceipts+1);
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),killExecutions+1);
    assert.equal(await bindingRows.countDocuments({ownerId,projectId:proof.projectId}),killBindings+1);
    assert.equal(providerRequests.length,killCalls);
    assert.deepEqual(await entitlement.findOne({principalId:ownerId}),balanceBeforeKill);
    assert.equal(killRow.executionId,settledBeforeKill.executionId);
    assert.equal(killCanonical.resultDigest,canonicalBeforeKill.resultDigest);
    assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,killBalance.consumedUnits+1);
    console.log('GREEN PHYSICAL_SETTLED_PRE_PUBLICATION_CONCURRENT_BROWSER_RECOVERY');
    await peer.getByRole('button',{name:'Request native writing'}).click();await peer.getByText('Server writer admitted',{exact:true}).waitFor({timeout:15000});
    const continuation='After settled worker SIGKILL '+randomUUID();
    await peer.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(continuation);
    await peer.getByRole('button',{name:'Send',exact:true}).click();await peer.getByLabel('Committed conversation transcript').getByText(continuation,{exact:true}).waitFor({timeout:20000});
    const killFinal=await projects.findOne({_id:proof.projectId});assert.equal(killFinal.revision,killAfter.revision+1);assert.deepEqual(killFinal.state.conversationMessages.slice(0,-2),killAfter.state.conversationMessages);
    assert.equal(killFinal.state.conversationMessages.at(-2).text,continuation);
    const continuedRow=await raceExecutions.findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:killFinal.state.conversationMessages.at(-2).id,phase:'settled'});
    assert.ok(continuedRow);const continuedCanonical=await composed.execution.authority.readCanonicalResult({executionId:continuedRow.executionId});
    assert.equal(continuedCanonical.authorized,true);assert.equal(killFinal.state.conversationMessages.at(-1).text,continuedCanonical.resultPayload.text);
    await Promise.all([signIn(),peerSignIn()]);
    for(const p of [page,peer])for(const txt of [...arbitrationHistory,...killBefore.state.conversationMessages.filter(m=>m.role==='creator').map(m=>m.text),killText,continuation])await p.getByLabel('Committed conversation transcript').getByText(txt,{exact:true}).waitFor({timeout:15000});
    assert.deepEqual(await projects.findOne({_id:proof.projectId}),killFinal);
    assert.equal(await receipts.countDocuments({projectId:proof.projectId}),killReceipts+2);
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),killExecutions+2);
    assert.equal(providerRequests.length,killCalls+5);
    assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,killBalance.consumedUnits+2);
    for(const prior of proof.prior){const actual=await projects.findOne({_id:prior.id});assert.equal(actual.revision,prior.revision);assert.deepEqual(actual.state,prior.state);}
    console.log('GREEN PHYSICAL_SETTLED_PRE_PUBLICATION_BROWSER_CONTINUATION_AND_RELOAD');
    }
    {
    await signIn();
    const before=await projects.findOne({_id:proof.projectId});
    const receiptCount=await receipts.countDocuments({projectId:proof.projectId});
    const executionCount=await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId});
    const bindingCount=await bindingRows.countDocuments({ownerId,projectId:proof.projectId});
    const calls=providerRequests.length;
    await entitlement.updateOne({principalId:ownerId},{$inc:{remainingUnits:2,entitlementRevision:1}});
    const balance=await entitlement.findOne({principalId:ownerId});
    await page.getByRole('button',{name:'Request native writing'}).click();
    await page.getByText('Server writer admitted',{exact:true}).waitFor({timeout:15000});
    const text='Durable publication before acknowledgement '+randomUUID();
    const manifest='./native-published-worker-'+randomUUID()+'.json',pause=manifest+'.pause';
    const env={...process.env,NATIVE_BOUND_WORKER_MANIFEST:manifest,NATIVE_BOUND_WORKER_PAUSE:pause,NATIVE_BOUND_WORKER_SETTLED:'1',NATIVE_BOUND_WORKER_PUBLISHED:'1'};
    delete env.NATIVE_INITIAL_PROVISION_RECOVERY;
    const worker=spawn(process.execPath,['./verify-physical-native-film-registration.mjs'],{env,stdio:['ignore','pipe','pipe']});
    let output='';worker.stdout.on('data',x=>output+=x);worker.stderr.on('data',x=>output+=x);
    const exited=new Promise(resolve=>worker.once('close',(status,signal)=>resolve({status,signal})));
    const readSignal=async path=>{for(let i=0;i<200;i++){try{return JSON.parse(readFileSync(path,'utf8'))}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('publication worker signal missing '+output)};
    let input,published,receipt,executionRow,canonicalResult,paidBalance,ledgerBeforeRecovery;
    let releaseRoute;const heldRoute=new Promise(r=>releaseRoute=r);
    let notifyLost;const lostAcknowledgement=new Promise(r=>notifyLost=r);
    let initiationRequests=0,publicationRequests=0;
    try{
     const address=await readSignal(manifest);assert.equal(address.pid,worker.pid);
     const send=async(path,body)=>fetch('http://127.0.0.1:'+address.port+path,{method:'POST',headers:{authorization:'Bearer '+owner,'content-type':'application/json'},body:JSON.stringify(body)});
     await page.route('**/native-authority/studio/native-execution-initiate',async route=>{
      initiationRequests++;const response=await send('/studio/native-execution-initiate',route.request().postDataJSON());
      const body=await response.json();assert.equal(body.ok,true);
      await route.fulfill({status:response.status,json:body});
     });
     await page.route('**/native-authority/studio/strict-conversation-settle',async route=>{
      publicationRequests++;input=route.request().postDataJSON();
      try{await send('/studio/strict-conversation-settle',input);notifyLost(false);}
      catch{notifyLost(true);}
      await heldRoute;
      await route.abort().catch(()=>{});
     });
     await page.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(text);
     await page.getByRole('button',{name:'Send',exact:true}).click();
     const signal=await readSignal(pause);
     assert.equal(signal.pid,worker.pid);assert.equal(initiationRequests,1);assert.equal(publicationRequests,1);
     assert.equal(signal.creatorTurnId,input.creatorTurnId);assert.equal(signal.fence,input.fence);
     assert.equal(signal.receipt.ok,true);assert.equal(signal.receipt.replay,false);
     published=await projects.findOne({_id:proof.projectId});
     assert.equal(published.revision,before.revision+1);
     assert.deepEqual(published.state.conversationMessages.slice(0,-2),before.state.conversationMessages);
     assert.equal(published.state.conversationMessages.at(-2).id,input.creatorTurnId);
     assert.equal(published.state.conversationMessages.at(-2).text,text);
     receipt=await receipts.findOne({projectId:proof.projectId,ownerId,operationId:input.operationId});
     assert.ok(receipt);assert.equal(receipt.commitId,signal.receipt.serverCommitId);
     assert.equal(receipt.creatorTurnId,input.creatorTurnId);assert.equal(receipt.revision,published.revision);
     assert.equal(await receipts.countDocuments({projectId:proof.projectId}),receiptCount+1);
     assert.equal(await bindingRows.countDocuments({ownerId,projectId:proof.projectId}),bindingCount+1);
     const binding=await bindingRows.findOne({ownerId,projectId:proof.projectId,creatorTurnId:input.creatorTurnId});
     assert.equal(binding.fence,input.fence);assert.equal(binding.creatorText,text);
     executionRow=await raceExecutions.findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:input.creatorTurnId,phase:'settled'});
     assert.ok(executionRow);canonicalResult=await composed.execution.authority.readCanonicalResult({executionId:executionRow.executionId});
     assert.equal(canonicalResult.authorized,true);assert.equal(canonicalResult.committed,true);assert.equal(canonicalResult.resultPayload.text,published.state.conversationMessages.at(-1).text);
     const reconciler=createMovieMentorInferenceSettlementReconciliationAuthority({store:createMovieMentorInferenceSettlementMongoStore()});
     const reconciled=await reconciler.reconcile({executionId:executionRow.executionId});
     assert.equal(reconciled.authorized,true);assert.equal(reconciled.settled,true);assert.equal(reconciled.outcome,'consumed');assert.equal(reconciled.resultDigest,canonicalResult.resultDigest);
     paidBalance=await entitlement.findOne({principalId:ownerId});assert.equal(paidBalance.consumedUnits,balance.consumedUnits+1);
     assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),executionCount+1);
     ledgerBeforeRecovery=await provenance.ledger.find({projectId:proof.projectId}).sort({revision:1}).toArray();
     const state=await gate.states.findOne({projectId:proof.projectId,ownerId,revoked:false});
     assert.equal(state.activeWriterFence,input.fence);
     assert.equal(await page.getByLabel('Committed conversation transcript').getByText(text,{exact:true}).count(),0);
     worker.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');
     assert.equal(await Promise.race([lostAcknowledgement,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('publication acknowledgement loss not observed')),15000);t.unref()})]),true);
     assert.deepEqual(await projects.findOne({_id:proof.projectId}),published);
     assert.deepEqual(await receipts.findOne({_id:receipt._id}),receipt);
     assert.deepEqual(await raceExecutions.findOne({executionId:executionRow.executionId}),executionRow);
     assert.deepEqual(await entitlement.findOne({principalId:ownerId}),paidBalance);
     console.log('PHYSICAL_PUBLISHED_ACK_LOSS_SIGKILL_EVIDENCE '+JSON.stringify({workerPid:worker.pid,recoveryPid:process.pid,signal:'SIGKILL',turn:input.creatorTurnId,commitId:receipt.commitId,revision:receipt.revision,executionId:executionRow.executionId,resultDigest:canonicalResult.resultDigest,workerProviderEffects:5,charges:1,publicationReceipts:1,acknowledgementLost:true}));
     console.log('GREEN PHYSICAL_DURABLE_PUBLICATION_ACK_LOSS_SIGKILL');
     const blank=page.goto('about:blank');releaseRoute();await blank;await page.unrouteAll({behavior:'wait'});
    }finally{if(worker.exitCode===null&&worker.signalCode===null)worker.kill('SIGKILL');await exited;releaseRoute();for(const f of [manifest,pause])try{unlinkSync(f)}catch{}}
    const receiptRequest={projectId:proof.projectId,operationId:input.operationId};
    assert.equal((await transport({path:'/studio/native-conversation-receipt',token:foreign,body:receiptRequest})).ok,false);
    const beforeRecoveryReceipt=await transport({path:'/studio/native-conversation-receipt',token:owner,body:receiptRequest});
    assert.equal(beforeRecoveryReceipt.ok,true);assert.equal(beforeRecoveryReceipt.serverCommitId,receipt.commitId);assert.equal(beforeRecoveryReceipt.creatorTurnId,input.creatorTurnId);
    const selected=await selection.read({token:owner,projectId:proof.vaultId});
    assert.equal((await transport({path:'/studio/native-conversation-cancel',token:owner,body:{projectId:proof.projectId,selectionVaultId:proof.vaultId,expectedRevision:published.revision,expectedSelectionRevision:selected.revision,confirmCancellation:true}})).ok,false);
    const recoveryRequests=[],recoveryResults=[];let releaseRecovery;
    const recoveryBarrier=new Promise(r=>releaseRecovery=r);
    for(const [label,p] of [['A',page],['B',peer]])await p.route('**/native-authority/studio/native-conversation-recover',async route=>{
     recoveryRequests.push(label);if(recoveryRequests.length===2)releaseRecovery();
     await recoveryBarrier;
     const response=await route.fetch(),body=await response.json();recoveryResults.push({label,...body});await route.fulfill({response});
    });
    await Promise.all([signIn(),peerSignIn()]);
    try{await Promise.all([page,peer].map(p=>p.getByLabel('Committed conversation transcript').getByText(text,{exact:true}).waitFor({timeout:20000})));}
    catch(error){console.error('PHYSICAL_PUBLISHED_ACK_LOSS_RECOVERY_TRACE '+JSON.stringify({recoveryRequests,recoveryResults,trace:recoveryTrace,bodies:await Promise.all([page,peer].map(p=>p.locator('body').innerText()))}));throw error;}
    assert.deepEqual(recoveryRequests.sort(),['A','B']);
    assert.equal(recoveryResults.length,2);assert.ok(recoveryResults.every(r=>r.ok===true));
    assert.ok(recoveryResults.some(r=>r.recovered===true&&r.receipt?.serverCommitId===receipt.commitId));
    for(const p of [page,peer]){await p.unrouteAll({behavior:'wait'});assert.equal(await p.getByLabel('Committed conversation transcript').getByText(text,{exact:true}).count(),1);}
    assert.deepEqual(await projects.findOne({_id:proof.projectId}),published);
    assert.deepEqual(await receipts.findOne({_id:receipt._id}),receipt);
    assert.deepEqual(await provenance.ledger.find({projectId:proof.projectId}).sort({revision:1}).toArray(),ledgerBeforeRecovery);
    assert.equal(await receipts.countDocuments({projectId:proof.projectId}),receiptCount+1);
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),executionCount+1);
    assert.equal(await bindingRows.countDocuments({ownerId,projectId:proof.projectId}),bindingCount+1);
    assert.equal(providerRequests.length,calls);
    assert.deepEqual(await entitlement.findOne({principalId:ownerId}),paidBalance);
    assert.deepEqual(await composed.execution.authority.readCanonicalResult({executionId:executionRow.executionId}),canonicalResult);
    const retired=await gate.admissions.findOne({projectId:proof.projectId,ownerId,fence:input.fence});assert.equal(retired.status,'retired');
    console.log('PHYSICAL_PUBLISHED_ACK_LOSS_RECOVERY_EVIDENCE '+JSON.stringify({requests:recoveryRequests,results:recoveryResults,additionalProviderEffects:0,additionalCharges:0,additionalPublications:0,commitId:receipt.commitId}));
    console.log('GREEN PHYSICAL_PUBLISHED_ACK_LOSS_CONCURRENT_RECEIPT_RECOVERY');
    await peer.getByRole('button',{name:'Request native writing'}).click();await peer.getByText('Server writer admitted',{exact:true}).waitFor({timeout:15000});
    const continuation='After durable publication SIGKILL '+randomUUID();
    await peer.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(continuation);
    await peer.getByRole('button',{name:'Send',exact:true}).click();await peer.getByLabel('Committed conversation transcript').getByText(continuation,{exact:true}).waitFor({timeout:20000});
    const final=await projects.findOne({_id:proof.projectId});
    assert.equal(final.revision,published.revision+1);assert.deepEqual(final.state.conversationMessages.slice(0,-2),published.state.conversationMessages);
    const row=await raceExecutions.findOne({principalId:ownerId,projectId:proof.projectId,creatorTurnId:final.state.conversationMessages.at(-2).id,phase:'settled'});
    assert.ok(row);const canonical=await composed.execution.authority.readCanonicalResult({executionId:row.executionId});
    assert.equal(canonical.authorized,true);assert.equal(canonical.resultPayload.text,final.state.conversationMessages.at(-1).text);
    await Promise.all([signIn(),peerSignIn()]);
    for(const p of [page,peer])for(const msg of final.state.conversationMessages.filter(m=>m.role==='creator'))await p.getByLabel('Committed conversation transcript').getByText(msg.text,{exact:true}).waitFor({timeout:15000});
    assert.deepEqual(await projects.findOne({_id:proof.projectId}),final);
    assert.deepEqual(await receipts.findOne({_id:receipt._id}),receipt);
    assert.deepEqual(await composed.execution.authority.readCanonicalResult({executionId:executionRow.executionId}),canonicalResult);
    assert.equal((await transport({path:'/studio/native-conversation-receipt',token:owner,body:receiptRequest})).serverCommitId,receipt.commitId);
    assert.equal(await receipts.countDocuments({projectId:proof.projectId}),receiptCount+2);
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId:proof.projectId}),executionCount+2);
    assert.equal(providerRequests.length,calls+5);assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,balance.consumedUnits+2);
    for(const prior of proof.prior){const actual=await projects.findOne({_id:prior.id});assert.equal(actual.revision,prior.revision);assert.deepEqual(actual.state,prior.state);}
    console.log('GREEN PHYSICAL_PUBLISHED_ACK_LOSS_BROWSER_CONTINUATION_AND_RELOAD');
    }

    {
    await signIn();
    const projectId=proof.projectId;
    const before=await projects.findOne({_id:projectId});
    const priorReceipts=await receipts.find({projectId}).sort({_id:1}).toArray();
    const priorLedger=await provenance.ledger.find({projectId}).sort({revision:1}).toArray();
    const executionCount=await raceExecutions.countDocuments({principalId:ownerId,projectId});
    const bindingCount=await bindingRows.countDocuments({ownerId,projectId});
    const calls=providerRequests.length;
    await entitlement.updateOne({principalId:ownerId},{$inc:{remainingUnits:2,entitlementRevision:1}});
    const balance=await entitlement.findOne({principalId:ownerId});
    await page.getByRole('button',{name:'Request native writing'}).click();
    await page.getByText('Server writer admitted',{exact:true}).waitFor({timeout:15000});
    const text='Publication transaction precommit '+randomUUID();
    const manifest='./native-precommit-worker-'+randomUUID()+'.json',pause=manifest+'.pause';
    const env={...process.env,NATIVE_BOUND_WORKER_MANIFEST:manifest,NATIVE_BOUND_WORKER_PAUSE:pause,NATIVE_BOUND_WORKER_SETTLED:'1',NATIVE_BOUND_WORKER_PRECOMMIT:'1'};
    delete env.NATIVE_INITIAL_PROVISION_RECOVERY;
    const worker=spawn(process.execPath,['./verify-physical-native-film-registration.mjs'],{env,stdio:['ignore','pipe','pipe']});
    let output='';worker.stdout.on('data',x=>output+=x);worker.stderr.on('data',x=>output+=x);
    const exited=new Promise(resolve=>worker.once('close',(status,signal)=>resolve({status,signal})));
    const readSignal=async path=>{for(let i=0;i<200;i++){try{return JSON.parse(readFileSync(path,'utf8'))}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('precommit worker signal missing '+output)};
    let input,signal,executionRow,canonicalResult,paidBalance,canonicalBefore,vaultBefore;
    let releaseRoute;const heldRoute=new Promise(r=>releaseRoute=r);
    let notifyLost;const lostAcknowledgement=new Promise(r=>notifyLost=r);
    let initiationRequests=0,publicationRequests=0;
    const assertInvisible=async()=>{
     assert.deepEqual(await projects.findOne({_id:projectId}),before);
     assert.deepEqual(await gate.states.findOne({projectId,ownerId,revoked:false}),canonicalBefore);
     assert.deepEqual(await gate.states.findOne({projectId:proof.vaultId,ownerId,revoked:false}),vaultBefore);
     assert.deepEqual(await receipts.find({projectId}).sort({_id:1}).toArray(),priorReceipts);
     assert.deepEqual(await provenance.ledger.find({projectId}).sort({revision:1}).toArray(),priorLedger);
    };
    try{
     const address=await readSignal(manifest);assert.equal(address.pid,worker.pid);assert.notEqual(worker.pid,process.pid);
     const send=(path,body)=>fetch('http://127.0.0.1:'+address.port+path,{method:'POST',headers:{authorization:'Bearer '+owner,'content-type':'application/json'},body:JSON.stringify(body)});
     await page.route('**/native-authority/studio/native-execution-initiate',async route=>{
      initiationRequests++;const response=await send('/studio/native-execution-initiate',route.request().postDataJSON());
      const body=await response.json();assert.equal(body.ok,true);
      canonicalBefore=await gate.states.findOne({projectId,ownerId,revoked:false});
      vaultBefore=await gate.states.findOne({projectId:proof.vaultId,ownerId,revoked:false});
      await route.fulfill({status:response.status,json:body});
     });
     await page.route('**/native-authority/studio/strict-conversation-settle',async route=>{
      publicationRequests++;input=route.request().postDataJSON();
      try{await send('/studio/strict-conversation-settle',input);notifyLost(false)}catch{notifyLost(true)}
      await heldRoute;await route.abort().catch(()=>{});
     });
     await page.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(text);
     await page.getByRole('button',{name:'Send',exact:true}).click();
     signal=await readSignal(pause);
     assert.equal(initiationRequests,1);assert.equal(publicationRequests,1);
     assert.equal(signal.pid,worker.pid);assert.equal(signal.projectId,projectId);
     assert.equal(signal.operationId,input.operationId);assert.equal(signal.creatorTurnId,input.creatorTurnId);assert.equal(signal.fence,input.fence);assert.equal(signal.revision,before.revision+1);
     assert.equal(canonicalBefore.activeWriterFence,input.fence);
     const activeTransaction=()=>client.db('admin').aggregate([{$currentOp:{allUsers:true,idleSessions:true}},{$match:{'lsid.id':new UUID(signal.sessionId),transaction:{$exists:true}}}]).toArray();
     assert.ok((await activeTransaction()).length>0,'precommit transaction not observable');
     await assertInvisible();
     executionRow=await raceExecutions.findOne({principalId:ownerId,projectId,creatorTurnId:input.creatorTurnId,phase:'settled'});assert.ok(executionRow);
     canonicalResult=await composed.execution.authority.readCanonicalResult({executionId:executionRow.executionId});
     assert.equal(canonicalResult.authorized,true);assert.equal(canonicalResult.committed,true);assert.equal(canonicalResult.resultPayload.text,input.mentorMessage.text);
     const reconciler=createMovieMentorInferenceSettlementReconciliationAuthority({store:createMovieMentorInferenceSettlementMongoStore()});
     const settled=await reconciler.reconcile({executionId:executionRow.executionId});assert.equal(settled.authorized,true);assert.equal(settled.settled,true);assert.equal(settled.outcome,'consumed');assert.equal(settled.resultDigest,canonicalResult.resultDigest);
     paidBalance=await entitlement.findOne({principalId:ownerId});assert.equal(paidBalance.consumedUnits,balance.consumedUnits+1);
     assert.equal(await page.getByLabel('Committed conversation transcript').getByText(text,{exact:true}).count(),0);
     worker.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');
     assert.equal(await Promise.race([lostAcknowledgement,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('precommit acknowledgement timeout')),15000);t.unref()})]),true);
     await assertInvisible();
     const deadline=Date.now()+95000;
     while((await activeTransaction()).length){assert.ok(Date.now()<deadline,'abandoned publication transaction not reaped');await new Promise(r=>setTimeout(r,250))}
     await assertInvisible();
     assert.deepEqual(await raceExecutions.findOne({executionId:executionRow.executionId}),executionRow);
     assert.deepEqual(await entitlement.findOne({principalId:ownerId}),paidBalance);
     assert.deepEqual(await composed.execution.authority.readCanonicalResult({executionId:executionRow.executionId}),canonicalResult);
     assert.equal(providerRequests.length,calls);
     console.log('PHYSICAL_PUBLICATION_PRECOMMIT_SIGKILL_EVIDENCE '+JSON.stringify({workerPid:worker.pid,recoveryPid:process.pid,signal:'SIGKILL',sessionId:signal.sessionId,transactionReaped:true,turn:input.creatorTurnId,revision:before.revision,stagedRevision:signal.revision,stagedCommitId:signal.commitId,publicationReceipts:0,acknowledgementLost:true,workerProviderEffects:5,charges:1}));
     console.log('GREEN PHYSICAL_PUBLICATION_PRECOMMIT_SIGKILL_ROLLBACK');
     const blank=page.goto('about:blank');releaseRoute();await blank;await page.unrouteAll({behavior:'wait'});
    }finally{if(worker.exitCode===null&&worker.signalCode===null)worker.kill('SIGKILL');await exited;releaseRoute();for(const f of [manifest,pause])try{unlinkSync(f)}catch{}}
    const receiptRequest={projectId,operationId:input.operationId};
    assert.equal((await transport({path:'/studio/native-conversation-receipt',token:owner,body:receiptRequest})).ok,false);
    assert.equal((await transport({path:'/studio/native-conversation-receipt',token:foreign,body:receiptRequest})).ok,false);
    await Promise.all([signIn(),peerSignIn()]);
    await Promise.all([page,peer].map(p=>p.getByLabel('Committed conversation transcript').getByText(text,{exact:true}).waitFor({timeout:20000})));
    const published=await projects.findOne({_id:projectId});assert.equal(published.revision,before.revision+1);
    assert.deepEqual(published.state.conversationMessages.slice(0,-2),before.state.conversationMessages);
    assert.equal(published.state.conversationMessages.at(-2).id,input.creatorTurnId);assert.equal(published.state.conversationMessages.at(-2).text,text);
    assert.equal(published.state.conversationMessages.at(-1).text,canonicalResult.resultPayload.text);
    const receipt=await receipts.findOne({projectId,operationId:input.operationId,ownerId});
    assert.ok(receipt);assert.equal(receipt.creatorTurnId,input.creatorTurnId);assert.equal(receipt.revision,published.revision);assert.equal(receipt.commitId,signal.commitId);
    const ledger=await provenance.ledger.find({projectId}).sort({revision:1}).toArray();assert.equal(ledger.length,priorLedger.length+1);assert.deepEqual(ledger.slice(0,-1),priorLedger);assert.equal(ledger.at(-1).operationId,input.operationId);
    for(const prior of priorReceipts)assert.deepEqual(await receipts.findOne({_id:prior._id}),prior);
    assert.equal(await receipts.countDocuments({projectId}),priorReceipts.length+1);
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId}),executionCount+1);
    assert.equal(await bindingRows.countDocuments({ownerId,projectId}),bindingCount+1);
    assert.equal(providerRequests.length,calls);assert.deepEqual(await entitlement.findOne({principalId:ownerId}),paidBalance);
    assert.deepEqual(await raceExecutions.findOne({executionId:executionRow.executionId}),executionRow);
    assert.deepEqual(await composed.execution.authority.readCanonicalResult({executionId:executionRow.executionId}),canonicalResult);
    assert.equal((await gate.admissions.findOne({projectId,ownerId,fence:input.fence})).status,'retired');
    assert.equal((await transport({path:'/studio/native-conversation-receipt',token:owner,body:receiptRequest})).serverCommitId,receipt.commitId);
    console.log('PHYSICAL_PUBLICATION_PRECOMMIT_RECOVERY_EVIDENCE '+JSON.stringify({turn:input.creatorTurnId,commitId:receipt.commitId,additionalProviderEffects:0,additionalCharges:0,publications:1}));
    console.log('GREEN PHYSICAL_PUBLICATION_PRECOMMIT_EXACTLY_ONCE_RECOVERY');
    await peer.getByRole('button',{name:'Request native writing'}).click();await peer.getByText('Server writer admitted',{exact:true}).waitFor({timeout:15000});
    const continuation='After publication transaction rollback '+randomUUID();
    await peer.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(continuation);
    await peer.getByRole('button',{name:'Send',exact:true}).click();await peer.getByLabel('Committed conversation transcript').getByText(continuation,{exact:true}).waitFor({timeout:20000});
    const final=await projects.findOne({_id:projectId});assert.equal(final.revision,published.revision+1);assert.deepEqual(final.state.conversationMessages.slice(0,-2),published.state.conversationMessages);
    await Promise.all([signIn(),peerSignIn()]);
    for(const p of [page,peer])for(const msg of final.state.conversationMessages.filter(m=>m.role==='creator'))await p.getByLabel('Committed conversation transcript').getByText(msg.text,{exact:true}).waitFor({timeout:15000});
    assert.deepEqual(await projects.findOne({_id:projectId}),final);assert.deepEqual(await receipts.findOne({_id:receipt._id}),receipt);
    assert.deepEqual(await composed.execution.authority.readCanonicalResult({executionId:executionRow.executionId}),canonicalResult);
    assert.equal(await receipts.countDocuments({projectId}),priorReceipts.length+2);
    assert.equal(await raceExecutions.countDocuments({principalId:ownerId,projectId}),executionCount+2);
    assert.equal(providerRequests.length,calls+5);assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,balance.consumedUnits+2);
    for(const prior of proof.prior){const actual=await projects.findOne({_id:prior.id});assert.equal(actual.revision,prior.revision);assert.deepEqual(actual.state,prior.state);}
    console.log('GREEN PHYSICAL_PUBLICATION_PRECOMMIT_BROWSER_CONTINUATION_AND_RELOAD');
    }






   }else console.log(proof.precommit?'GREEN PHYSICAL_PRECOMMIT_REGISTRATION_BROWSER_CONTINUATION_AND_RELOAD':'GREEN PHYSICAL_INITIAL_PROVISIONING_FRESH_PROCESS_CONTINUATION_AND_RELOAD');
  }finally{if(peerBrowser)await peerBrowser.close();if(browser)await browser.close();if(vite)vite.kill();for(const f of candidate.files)try{unlinkSync(f.path)}catch{}if(executionServer)await new Promise(r=>executionServer.close(r));await new Promise(r=>providerServer.close(r));}
 }else if(process.env.NATIVE_POST_EXIT_READBACK){
  const expected=JSON.parse(process.env.NATIVE_POST_EXIT_READBACK);
  assert.notEqual(process.pid,expected.originalPid);
  const transport=async({path,token,body})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return r.json()};
  const factory=createApplicationStudioSessionFactory({transport,resolveSelectionVaultId:async({token})=>(await vaults.resolve({token})).vaultId,readLocalBytes:()=>'unchanged-local-bytes'});
  const session=factory({getAuthToken:async()=>owner}),opened=await session.open();assert.equal(opened.ok,true);
  const recovered=await opened.services.resumeNativeConversation({projectId:expected.projectId});
  assert.equal(recovered.ok,true,JSON.stringify(recovered));
  assert.equal(recovered.view.projectRevision,expected.revision);
  assert.deepEqual(recovered.view.conversationMessages,expected.history);
  assert.equal(recovered.view.writable,false);
  assert.equal(await receipts.countDocuments({projectId:expected.projectId}),expected.receipts);
  assert.equal((await mongoose.connection.db.collection('movie_mentor_inference_entitlement').findOne({principalId:ownerId})).consumedUnits,expected.consumedUnits);
  console.log('GREEN PHYSICAL_ORIGINAL_PROCESS_EXIT_CANONICAL_CONVERSATION_READBACK');
 }else if(process.env.NATIVE_CANONICAL_RESTART_COURT){
  const expected=JSON.parse(process.env.NATIVE_CANONICAL_RESTART_COURT);
  if(expected.originalPid){
   assert.notEqual(process.pid,expected.originalPid);
   const pending=await projects.findOne({_id:expected.projectId});
   assert.equal(pending.revision,expected.revision);
   assert.deepEqual(pending.state.conversationMessages,expected.history);
   assert.equal(await receipts.countDocuments({projectId:expected.projectId}),expected.receipts);
   assert.equal((await mongoose.connection.db.collection('movie_mentor_inference_entitlement').findOne({principalId:ownerId})).consumedUnits,expected.consumedUnits);
  }
  const execution=createMovieMentorProductionInferenceExecutionComposition();
  assert.equal(execution.ready,true);
  const accounting=createMovieMentorInferenceSettlementReconciliationAuthority({store:createMovieMentorInferenceSettlementMongoStore()});
  composeCanonicalRecovery(execution,accounting);
  const transport=async({path,token,body})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return r.json()};
  const factory=createApplicationStudioSessionFactory({transport,resolveSelectionVaultId:async({token})=>(await vaults.resolve({token})).vaultId,readLocalBytes:()=>'unchanged-local-bytes'});
  const session=factory({getAuthToken:async()=>owner}),opened=await session.open();
  assert.equal(opened.ok,true);
  const recovered=await opened.services.resumeNativeConversation({projectId:expected.projectId});
  assert.equal(recovered.ok,true,'fresh server must reconstruct completed unpublished canonical turn: '+JSON.stringify(recovered));
  assert.equal(recovered.view.writable,false);
  assert.equal(recovered.view.projectRevision,expected.revision+1);
  assert.deepEqual(recovered.view.conversationMessages.slice(0,-2),expected.history);
  assert.equal(recovered.view.conversationMessages.at(-2).id,expected.creatorTurnId);
  assert.equal(recovered.view.conversationMessages.at(-2).text,expected.text);
  assert.equal(await receipts.countDocuments({projectId:expected.projectId}),expected.receipts+1);
  console.log('GREEN PHYSICAL_INDEPENDENT_SERVER_CANONICAL_UNPUBLISHED_RECOVERY');
  const repeated=await opened.services.resumeNativeConversation({projectId:expected.projectId});
  assert.equal(repeated.ok,true,JSON.stringify(repeated));
  assert.deepEqual(repeated.view.conversationMessages,recovered.view.conversationMessages);
  assert.equal(repeated.view.projectRevision,recovered.view.projectRevision);
  assert.equal(await receipts.countDocuments({projectId:expected.projectId}),expected.receipts+1);
  console.log('GREEN PHYSICAL_STOPPED_SERVER_CANONICAL_RECOVERY_REPEAT_READBACK');
  if(expected.originalPid){
   assert.equal((await mongoose.connection.db.collection('movie_mentor_inference_entitlement').findOne({principalId:ownerId})).consumedUnits,expected.consumedUnits);
   console.log('GREEN PHYSICAL_UNPUBLISHED_CANONICAL_RECOVERY_AFTER_ORIGINAL_PROCESS_EXIT');
   const {providerServer,providerRequests}=await startIsolatedProvider();
   let freshExecutionServer;
   try{
    const composed=await composeCanonicalExecution();freshExecutionServer=composed.server;
    await registerCanonicalSubmission(composed.strict,composed.call);
    const entitlement=mongoose.connection.db.collection('movie_mentor_inference_entitlement');
    await entitlement.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
    const selectionVaultId=(await vaults.resolve({token:owner})).vaultId;
    const admitted=await opened.services.applicationSecondFilm.requestEditing({token:owner,selectionVaultId,operationId:'post-restart-continuation-'+randomUUID()});
    assert.equal(admitted.ok,true,JSON.stringify(admitted));
    const creatorMessage={id:randomUUID(),role:'creator',text:'Continue the recovered movie '+randomUUID()};
    const continued=await opened.services.submitNativeConversation({creatorMessage},{canonical:true});
    assert.equal(continued.ok,true,JSON.stringify(continued));
    assert.equal(continued.view.projectRevision,expected.revision+2);
    assert.deepEqual(continued.view.conversationMessages.slice(0,-2),recovered.view.conversationMessages);
    assert.deepEqual(continued.view.conversationMessages.at(-2),creatorMessage);
    assert.equal(await receipts.countDocuments({projectId:expected.projectId}),expected.receipts+2);
    assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,expected.consumedUnits+1);
    assert.equal(providerRequests.length,5);
    const readback=await opened.services.resumeNativeConversation({projectId:expected.projectId});
    assert.equal(readback.ok,true,JSON.stringify(readback));
    assert.deepEqual(readback.view.conversationMessages,continued.view.conversationMessages);
    assert.equal(readback.view.projectRevision,continued.view.projectRevision);
    console.log('GREEN PHYSICAL_POST_RESTART_CANONICAL_SERVICE_CONTINUATION');
    assert.ok(process.env.NATIVE_RESTART_BROWSER_MANIFEST,'fresh browser candidate manifest required');
    const candidate=JSON.parse(readFileSync(process.env.NATIVE_RESTART_BROWSER_MANIFEST,'utf8')).browserCandidate;
    const root='../frontend/',base=candidate.base,config=root+base+'.config.mjs';
    let freshBrowser,freshVite;
    try{
     for(const file of candidate.files)writeFileSync(file.path,file.content);
     writeFileSync(config,`import {defineConfig} from 'vite';import react from '@vitejs/plugin-react-swc';export default defineConfig({plugins:[react()],server:{proxy:{'/native-authority':{target:'http://127.0.0.1:${server.address().port}',changeOrigin:true,rewrite:path=>path.replace(/^\\/native-authority/,'')}}}});`);
     freshVite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port','52769','--strictPort','--config',base+'.config.mjs'],{cwd:root,stdio:['ignore','pipe','pipe']});
     let output='';freshVite.stdout.on('data',x=>output+=x);freshVite.stderr.on('data',x=>output+=x);
     const url='http://127.0.0.1:52769/'+base+'.html';
     let ready=false;for(let i=0;i<100;i++){try{if((await fetch(url)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}
     assert.ok(ready,output);
     const {chromium}=await import('playwright');freshBrowser=await chromium.launch({headless:true});
     let page=await freshBrowser.newPage();
     const signIn=async()=>{await page.goto(url);await page.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000});await page.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner)};
     await signIn();
     let region=page.getByLabel('Native cockpit conversation'),transcript=region.getByLabel('Committed conversation transcript'),composer=region.getByPlaceholder("Tell Movie Mentor what's on your mind...");
     await transcript.getByText(creatorMessage.text,{exact:true}).waitFor({timeout:15000});
     const previous=await projects.findOne({_id:expected.projectId});
     assert.deepEqual(previous.state.conversationMessages,continued.view.conversationMessages);
     await entitlement.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
     await page.getByRole('button',{name:'Request native writing'}).click();
     await page.getByText('Server writer admitted',{exact:true}).waitFor();
     const browserText='Fresh process browser continuation '+randomUUID();
     await composer.fill(browserText);
     await region.getByRole('button',{name:'Send',exact:true}).click();
     await transcript.getByText(browserText,{exact:true}).waitFor({timeout:20000});
     const published=await projects.findOne({_id:expected.projectId});
     assert.equal(published.revision,previous.revision+1);
     assert.deepEqual(published.state.conversationMessages.slice(0,-2),previous.state.conversationMessages);
     const [creator,mentor]=published.state.conversationMessages.slice(-2);
     assert.equal(creator.text,browserText);
     const row=await mongoose.connection.db.collection('movie_mentor_inference_execution').findOne({principalId:ownerId,projectId:expected.projectId,creatorTurnId:creator.id,phase:'settled'});
     assert.ok(row);
     const canonical=await composed.execution.authority.readCanonicalResult({executionId:row.executionId});
     assert.equal(canonical.authorized,true);
     assert.equal(mentor.text,canonical.resultPayload.text);
     assert.equal(await receipts.countDocuments({projectId:expected.projectId}),expected.receipts+3);
     assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,expected.consumedUnits+2);
     assert.equal(providerRequests.length,10);
     await signIn();
     await transcript.getByText(browserText,{exact:true}).waitFor({timeout:15000});
     assert.deepEqual(await projects.findOne({_id:expected.projectId}),published);
     assert.equal(await receipts.countDocuments({projectId:expected.projectId}),expected.receipts+3);
     assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,expected.consumedUnits+2);
     assert.equal(providerRequests.length,10);
     console.log('GREEN PHYSICAL_POST_RESTART_GENUINE_BROWSER_COMPOSER_CONTINUATION_AND_RELOAD');
     const secondFilm=expected.secondFilm;
     assert.ok(secondFilm&&secondFilm.projectId!==expected.projectId);
     const secondId=secondFilm.projectId;
     const secondBefore=await projects.findOne({_id:secondId});
     assert.equal(secondBefore.revision,secondFilm.project.revision);
     assert.deepEqual(secondBefore.state.conversationMessages,secondFilm.project.state.conversationMessages);
     assert.equal(await receipts.countDocuments({projectId:secondId}),secondFilm.receipts);
     // Provision only the missing isolated canonical fixture for the existing second movie.
     const secondPolicy=await gate.states.updateOne({projectId:secondId,ownerId,revoked:false,activeWriterFence:{$exists:false}},{$set:{strictCanonicalConversation:true}});
     assert.equal(secondPolicy.modifiedCount,1);
     const seed=randomUUID();
     await mongoose.connection.db.collection('movie_mentor_creator_state').insertOne({projectId:secondId,revision:0,revisionAuthorityReference:'strict-'+seed,creatorStateGeneration:1,creatorStateFingerprint:'strict-fingerprint-'+seed,creatorAuthorityReference:'strict-authority-'+seed,snapshotReference:'strict-snapshot-'+seed,capturedAt:new Date()});
     const choose=async(id,history)=>{
      await page.getByLabel('Existing movie project ID').fill(id);
      await page.getByRole('button',{name:'Recover server-authorised film'}).click();
      await page.waitForFunction(id=>document.querySelector('[aria-label="Verified native movie"]')?.textContent===id,id);
      for(const message of history.filter(m=>m.role==='creator'))await transcript.getByText(message.text,{exact:true}).first().waitFor({timeout:15000});
     };
     const submitBrowserTurn=async(id,before,text)=>{
      const count=await receipts.countDocuments({projectId:id}),balance=await entitlement.findOne({principalId:ownerId}),calls=providerRequests.length;
      await entitlement.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
      await page.getByRole('button',{name:'Request native writing'}).click();
      await page.getByText('Server writer admitted',{exact:true}).waitFor();
      await composer.fill(text);
      await region.getByRole('button',{name:'Send',exact:true}).click();
      await transcript.getByText(text,{exact:true}).waitFor({timeout:20000});
      const after=await projects.findOne({_id:id});
      assert.equal(after.revision,before.revision+1);
      assert.deepEqual(after.state.conversationMessages.slice(0,-2),before.state.conversationMessages);
      const [creator,mentor]=after.state.conversationMessages.slice(-2);
      assert.equal(creator.text,text);
      const executionRow=await mongoose.connection.db.collection('movie_mentor_inference_execution').findOne({principalId:ownerId,projectId:id,creatorTurnId:creator.id,phase:'settled'});
      assert.ok(executionRow);
      const result=await composed.execution.authority.readCanonicalResult({executionId:executionRow.executionId});
      assert.equal(result.authorized,true);
      assert.equal(mentor.text,result.resultPayload.text);
      assert.equal(await receipts.countDocuments({projectId:id}),count+1);
      assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,balance.consumedUnits+1);
      assert.equal(providerRequests.length,calls+5);
      return after;
     };
     await choose(secondId,secondBefore.state.conversationMessages);
     assert.equal(await transcript.getByText(browserText,{exact:true}).count(),0);
     const secondText='Second movie after restart '+randomUUID();
     const secondAfter=await submitBrowserTurn(secondId,secondBefore,secondText);
     assert.deepEqual(await projects.findOne({_id:expected.projectId}),published);
     await choose(expected.projectId,published.state.conversationMessages);
     assert.equal(await transcript.getByText(secondText,{exact:true}).count(),0);
     const firstText='First movie after switching back '+randomUUID();
     const firstAfter=await submitBrowserTurn(expected.projectId,published,firstText);
     assert.deepEqual(await projects.findOne({_id:secondId}),secondAfter);
     await signIn();
     await transcript.getByText(firstText,{exact:true}).waitFor({timeout:15000});
     await choose(secondId,secondAfter.state.conversationMessages);
     await signIn();
     await transcript.getByText(secondText,{exact:true}).waitFor({timeout:15000});
     assert.equal(await transcript.getByText(firstText,{exact:true}).count(),0);
     await choose(expected.projectId,firstAfter.state.conversationMessages);
     assert.equal(await transcript.getByText(secondText,{exact:true}).count(),0);
     assert.deepEqual(await projects.findOne({_id:expected.projectId}),firstAfter);
     assert.deepEqual(await projects.findOne({_id:secondId}),secondAfter);
     assert.equal(await receipts.countDocuments({projectId:expected.projectId}),expected.receipts+4);
     assert.equal(await receipts.countDocuments({projectId:secondId}),secondFilm.receipts+1);
     assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,expected.consumedUnits+4);
     assert.equal(providerRequests.length,20);
     console.log('GREEN PHYSICAL_POST_RESTART_TWO_FILM_BROWSER_CONTINUITY_AND_ACCOUNTING');
     const beforeCreationBalance=await entitlement.findOne({principalId:ownerId}),beforeCreationCalls=providerRequests.length;
     await page.getByRole('button',{name:'Create new movie'}).click();
     await page.waitForFunction(previous=>{const id=document.querySelector('[aria-label="Verified native movie"]')?.textContent;return id?.startsWith('movie-project-')&&id!==previous},expected.projectId);
     const newId=await page.getByLabel('Verified native movie').textContent();
     assert.notEqual(newId,secondId);
     const initial=await projects.findOne({_id:newId});
     assert.equal(initial.revision,1);
     assert.deepEqual(initial.state.conversationMessages,[]);
     assert.equal((await gate.states.findOne({projectId:newId,ownerId})).strictCanonicalConversation,true);
     const provisioned=await canonicalCreatorStates.findOne({projectId:newId});
     assert.ok(provisioned);
     assert.equal(provisioned.revision,0);
     assert.equal(await canonicalCreatorStates.countDocuments({projectId:newId}),1);
     assert.equal(await receipts.countDocuments({projectId:newId}),0);
     assert.deepEqual(await entitlement.findOne({principalId:ownerId}),beforeCreationBalance);
     assert.equal(providerRequests.length,beforeCreationCalls);
     const replay=await transport({path:'/studio/native-film-register',token:owner,body:{projectId:newId}});
     assert.equal(replay.ok,true);
     assert.equal(replay.replayed,true);
     assert.deepEqual(await canonicalCreatorStates.findOne({projectId:newId}),provisioned);
     assert.deepEqual(await projects.findOne({_id:newId}),initial);
     const newText='Automatically provisioned movie '+randomUUID();
     const newAfter=await submitBrowserTurn(newId,initial,newText);
     const afterTurnState=await canonicalCreatorStates.findOne({projectId:newId});
     const replayAfter=await transport({path:'/studio/native-film-register',token:owner,body:{projectId:newId}});
     assert.equal(replayAfter.ok,true);
     assert.equal(replayAfter.replayed,true);
     assert.deepEqual(await canonicalCreatorStates.findOne({projectId:newId}),afterTurnState);
     assert.equal(await canonicalCreatorStates.countDocuments({projectId:newId}),1);
     await signIn();
     await transcript.getByText(newText,{exact:true}).waitFor({timeout:15000});
     assert.deepEqual(await projects.findOne({_id:newId}),newAfter);
     assert.deepEqual(await projects.findOne({_id:expected.projectId}),firstAfter);
     assert.deepEqual(await projects.findOne({_id:secondId}),secondAfter);
     assert.equal(await receipts.countDocuments({projectId:newId}),1);
     assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,beforeCreationBalance.consumedUnits+1);
     assert.equal(providerRequests.length,beforeCreationCalls+5);
     console.log('GREEN PHYSICAL_AUTOMATIC_CANONICAL_MOVIE_PROVISIONING_BROWSER_CONTINUATION_AND_REPLAY');
     const registrationBalance=await entitlement.findOne({principalId:ownerId}),registrationCalls=providerRequests.length;
     const vaultBefore=await gate.states.findOne({projectId:selectionVaultId,ownerId});
     const vaultLedgerBefore=await provenance.ledger.countDocuments({projectId:selectionVaultId});
     const oldProjects=await projects.countDocuments({ownerId});
     const createButton=page.getByRole('button',{name:'Create new movie'});
     const errorMessage=page.getByText('Movie recovery unavailable',{exact:true});
     failNextRegistration=true;
     await createButton.click();
     await errorMessage.waitFor({timeout:15000});
     assert.equal(failNextRegistration,false);
     assert.ok(failedRegistrationId);
     const retryId=failedRegistrationId;
     assert.equal(await canonicalCreatorStates.countDocuments({projectId:retryId}),0);
     assert.equal(await projects.countDocuments({_id:retryId}),0);
     assert.equal(await gate.states.countDocuments({projectId:retryId}),0);
     assert.equal(await provenance.ledger.countDocuments({projectId:retryId}),0);
     assert.equal(await receipts.countDocuments({projectId:retryId}),0);
     assert.deepEqual(await gate.states.findOne({projectId:selectionVaultId,ownerId}),vaultBefore);
     assert.equal(await provenance.ledger.countDocuments({projectId:selectionVaultId}),vaultLedgerBefore);
     assert.equal(await projects.countDocuments({ownerId}),oldProjects);
     assert.deepEqual(await entitlement.findOne({principalId:ownerId}),registrationBalance);
     assert.equal(providerRequests.length,registrationCalls);
     console.log('GREEN PHYSICAL_CANONICAL_REGISTRATION_PRECOMMIT_ROLLBACK');
     dropNextRegistrationAck=true;
     await createButton.click();
     await errorMessage.waitFor({timeout:15000});
     assert.equal(dropNextRegistrationAck,false);
     assert.equal(droppedRegistrationId,retryId);
     const registeredProject=await projects.findOne({_id:retryId});
     const registeredCanonical=await canonicalCreatorStates.findOne({projectId:retryId});
     assert.ok(registeredProject&&registeredCanonical);
     assert.equal(registeredProject.revision,1);
     assert.equal(await canonicalCreatorStates.countDocuments({projectId:retryId}),1);
     assert.equal(await projects.countDocuments({ownerId}),oldProjects+1);
     assert.equal(await provenance.ledger.countDocuments({projectId:retryId}),1);
     assert.equal(await provenance.ledger.countDocuments({projectId:selectionVaultId,operationId:'register:'+retryId}),1);
     assert.deepEqual(await entitlement.findOne({principalId:ownerId}),registrationBalance);
     assert.equal(providerRequests.length,registrationCalls);
     await createButton.click();
     await page.waitForFunction(id=>document.querySelector('[aria-label="Verified native movie"]')?.textContent===id,retryId);
     assert.deepEqual(await canonicalCreatorStates.findOne({projectId:retryId}),registeredCanonical);
     assert.deepEqual(await projects.findOne({_id:retryId}),registeredProject);
     assert.equal(await canonicalCreatorStates.countDocuments({projectId:retryId}),1);
     assert.equal(await projects.countDocuments({ownerId}),oldProjects+1);
     assert.equal(await provenance.ledger.countDocuments({projectId:selectionVaultId,operationId:'register:'+retryId}),1);
     assert.deepEqual(await entitlement.findOne({principalId:ownerId}),registrationBalance);
     console.log('GREEN PHYSICAL_CANONICAL_REGISTRATION_ACK_LOSS_SAME_ID_RECOVERY');
     const retryText='Recovered registration composer '+randomUUID();
     const retryAfter=await submitBrowserTurn(retryId,registeredProject,retryText);
     await signIn();
     await transcript.getByText(retryText,{exact:true}).waitFor({timeout:15000});
     assert.deepEqual(await projects.findOne({_id:retryId}),retryAfter);
     assert.deepEqual(await projects.findOne({_id:newId}),newAfter);
     assert.deepEqual(await projects.findOne({_id:expected.projectId}),firstAfter);
     assert.deepEqual(await projects.findOne({_id:secondId}),secondAfter);
     assert.equal(await receipts.countDocuments({projectId:retryId}),1);
     assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,registrationBalance.consumedUnits+1);
     assert.equal(providerRequests.length,registrationCalls+5);
     console.log('GREEN PHYSICAL_CANONICAL_REGISTRATION_INTERRUPTION_BROWSER_CONTINUATION_AND_RELOAD');
     const terminationBalance=await entitlement.findOne({principalId:ownerId}),terminationCalls=providerRequests.length,terminationCount=await projects.countDocuments({ownerId});
     dropNextRegistrationAck=true;
     await page.getByRole('button',{name:'Create new movie'}).click();
     await page.getByText('Movie recovery unavailable',{exact:true}).waitFor({timeout:15000});
     assert.equal(dropNextRegistrationAck,false);
     const terminatedId=droppedRegistrationId;
     assert.notEqual(terminatedId,retryId);
     const durableIntent=await registrationIntents.findOne({ownerId});
     assert.equal(durableIntent.projectId,terminatedId);
     const terminatedProject=await projects.findOne({_id:terminatedId}),terminatedCanonical=await canonicalCreatorStates.findOne({projectId:terminatedId});
     assert.ok(terminatedProject&&terminatedCanonical);
     const denied=await transport({path:'/studio/native-registration-intent',token:foreign,body:{}});
     assert.notEqual(denied.projectId,terminatedId);
     await freshBrowser.close();
     freshBrowser=await chromium.launch({headless:true});
     page=await freshBrowser.newPage();
     region=page.getByLabel('Native cockpit conversation');transcript=region.getByLabel('Committed conversation transcript');composer=region.getByPlaceholder("Tell Movie Mentor what's on your mind...");
     await signIn();
     await page.waitForFunction(id=>document.querySelector('[aria-label="Verified native movie"]')?.textContent===id,terminatedId);
     assert.equal(await registrationIntents.countDocuments({ownerId}),0);
     assert.deepEqual(await projects.findOne({_id:terminatedId}),terminatedProject);
     assert.deepEqual(await canonicalCreatorStates.findOne({projectId:terminatedId}),terminatedCanonical);
     assert.equal(await projects.countDocuments({ownerId}),terminationCount+1);
     assert.equal(await canonicalCreatorStates.countDocuments({projectId:terminatedId}),1);
     assert.equal(await provenance.ledger.countDocuments({projectId:terminatedId}),1);
     assert.deepEqual(await entitlement.findOne({principalId:ownerId}),terminationBalance);
     assert.equal(providerRequests.length,terminationCalls);
     console.log('GREEN PHYSICAL_DURABLE_REGISTRATION_FRESH_BROWSER_IDENTITY_RECOVERY');
     const terminationText='Fresh browser registration recovery '+randomUUID();
     const terminationAfter=await submitBrowserTurn(terminatedId,terminatedProject,terminationText);
     await signIn();
     await transcript.getByText(terminationText,{exact:true}).waitFor({timeout:15000});
     assert.deepEqual(await projects.findOne({_id:terminatedId}),terminationAfter);
     for(const [id,prior] of [[retryId,retryAfter],[newId,newAfter],[expected.projectId,firstAfter],[secondId,secondAfter]])assert.deepEqual(await projects.findOne({_id:id}),prior);
     assert.equal(await receipts.countDocuments({projectId:terminatedId}),1);
     assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,terminationBalance.consumedUnits+1);
     assert.equal(providerRequests.length,terminationCalls+5);
     console.log('GREEN PHYSICAL_DURABLE_REGISTRATION_FRESH_BROWSER_CONTINUATION_AND_RELOAD');
     const concurrentBalance=await entitlement.findOne({principalId:ownerId}),concurrentCalls=providerRequests.length,concurrentCount=await projects.countDocuments({ownerId});
     dropNextRegistrationAck=true;
     await page.getByRole('button',{name:'Create new movie'}).click();
     await page.getByText('Movie recovery unavailable',{exact:true}).waitFor({timeout:15000});
     const concurrentId=droppedRegistrationId;
     assert.equal((await registrationIntents.findOne({ownerId})).projectId,concurrentId);
     const concurrentInitial=await projects.findOne({_id:concurrentId});
     const selectionBefore=await selection.read({token:owner,projectId:selectionVaultId});
     const secondBrowser=await chromium.launch({headless:true});
     try{
      const other=await secondBrowser.newPage();
      // Hold both intent responses until both independently authenticated requests have read the pending identity.
      let arrivals=0,release;const barrier=new Promise(r=>release=r);
      const route=async(route)=>{const response=await route.fetch();const payload=await response.json();if(payload.projectId===concurrentId){arrivals++;if(arrivals===2)release();await barrier;}await route.fulfill({response});};
      await page.route('**/native-authority/studio/native-registration-intent',route);
      await other.route('**/native-authority/studio/native-registration-intent',route);
      await Promise.all([signIn(),(async()=>{await other.goto(url);await other.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000});await other.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner)})()]);
      await Promise.all([page,other].map(p=>p.waitForFunction(id=>document.querySelector('[aria-label="Verified native movie"]')?.textContent===id,concurrentId,{timeout:20000})));
      assert.equal(arrivals,2);
      await page.unroute('**/native-authority/studio/native-registration-intent',route);
      assert.equal(await registrationIntents.countDocuments({ownerId}),0);
      assert.equal(await registrationCompletions.countDocuments({ownerId,projectId:concurrentId}),1);
      assert.equal(await canonicalCreatorStates.countDocuments({projectId:concurrentId}),1);
      assert.equal(await projects.countDocuments({ownerId}),concurrentCount+1);
      assert.equal(await provenance.ledger.countDocuments({projectId:concurrentId}),1);
      const selected=await selection.read({token:owner,projectId:selectionVaultId});
      assert.equal(selected.activeProjectId,concurrentId);
      assert.equal(selected.revision,selectionBefore.revision+1);
      const nextId='movie-project-'+randomUUID();
      assert.equal((await transport({path:'/studio/native-registration-intent',token:owner,body:{projectId:nextId}})).projectId,nextId);
      const newer=await registrationIntents.findOne({ownerId});
      assert.equal((await transport({path:'/studio/native-registration-complete',token:owner,body:{projectId:concurrentId}})).ok,false);
      assert.deepEqual(await registrationIntents.findOne({ownerId}),newer);
      assert.equal((await transport({path:'/studio/selection-change',token:owner,body:{projectId:selectionVaultId,operationId:'browser-route-create-'+concurrentId,expectedRevision:selected.revision,nextActiveProjectId:concurrentId}})).ok,false);
      assert.deepEqual(await selection.read({token:owner,projectId:selectionVaultId}),selected);
      assert.deepEqual(await entitlement.findOne({principalId:ownerId}),concurrentBalance);
      assert.equal(providerRequests.length,concurrentCalls);
      console.log('GREEN PHYSICAL_CONCURRENT_DURABLE_REGISTRATION_COMPLETION_AND_STALE_DENIAL');
      // Complete the newer intent through the normal authenticated browser route.
      await signIn();
      await page.waitForFunction(id=>document.querySelector('[aria-label="Verified native movie"]')?.textContent===id,nextId);
      assert.equal(await registrationIntents.countDocuments({ownerId}),0);
      assert.equal(await registrationCompletions.countDocuments({ownerId,projectId:nextId}),1);
      assert.equal(await projects.countDocuments({ownerId}),concurrentCount+2);
      await choose(concurrentId,[]);
      const concurrentText='Concurrent recovered registration '+randomUUID();
      const concurrentAfter=await submitBrowserTurn(concurrentId,concurrentInitial,concurrentText);
      await signIn();
      await transcript.getByText(concurrentText,{exact:true}).waitFor({timeout:15000});
      assert.deepEqual(await projects.findOne({_id:concurrentId}),concurrentAfter);
      for(const [id,prior] of [[terminatedId,terminationAfter],[retryId,retryAfter],[newId,newAfter],[expected.projectId,firstAfter],[secondId,secondAfter]])assert.deepEqual(await projects.findOne({_id:id}),prior);
      assert.equal(await receipts.countDocuments({projectId:concurrentId}),1);
      assert.equal((await entitlement.findOne({principalId:ownerId})).consumedUnits,concurrentBalance.consumedUnits+1);
      assert.equal(providerRequests.length,concurrentCalls+5);
      console.log('GREEN PHYSICAL_CONCURRENT_REGISTRATION_BROWSER_CONTINUATION_AND_RELOAD');
     }finally{await secondBrowser.close();}
     const initialCount=await projects.countDocuments({ownerId}),initialBalance=await entitlement.findOne({principalId:ownerId});
     const initialSelection=await selection.read({token:owner,projectId:selectionVaultId});
     const prior=(await projects.find({ownerId}).toArray()).map(p=>({id:p._id,revision:p.revision,state:p.state}));
     const workerManifest='./native-initial-worker-'+randomUUID()+'.json';
     const childEnv={...process.env};delete childEnv.NATIVE_CANONICAL_RESTART_COURT;
     const worker=spawn(process.execPath,['./verify-physical-native-film-registration.mjs'],{env:{...childEnv,NATIVE_INITIAL_PROVISION_WORKER:workerManifest},stdio:['ignore','pipe','pipe']});
     let workerOutput='';worker.stdout.on('data',x=>workerOutput+=x);worker.stderr.on('data',x=>workerOutput+=x);
     const workerExit=new Promise(resolve=>worker.once('close',(status,signal)=>resolve({status,signal})));
     let proof;
     try{
      let address;for(let i=0;i<100;i++){try{address=JSON.parse(readFileSync(workerManifest,'utf8'));break}catch{}await new Promise(r=>setTimeout(r,100))}
      assert.ok(address,workerOutput);assert.equal(address.pid,worker.pid);
      const request=async(path,body,token=owner)=>{const r=await fetch('http://127.0.0.1:'+address.port+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return r.json()};
      const proposals=['movie-project-'+randomUUID(),'movie-project-'+randomUUID()];
      const intents=await Promise.all(proposals.map(projectId=>request('/studio/native-registration-intent',{projectId})));
      assert.ok(intents.every(i=>i.ok&&i.enabled));assert.equal(intents[0].projectId,intents[1].projectId);
      const id=intents[0].projectId;assert.ok(proposals.includes(id));assert.equal(await projects.countDocuments({_id:id}),0);
      const identity={domain:'iband.movie-mentor.project',schema:1,issuance:'secure-web-crypto',legacy:false};
      const ownership=await request('/api/movie-mentor/projects',{projectId:id,identity});assert.equal(ownership.success,true);
      const requests=[0,1].map(()=>request('/studio/native-film-register',{projectId:id}).then(()=>false,()=>true));
      let committed=false;for(let i=0;i<150;i++){if(await projects.findOne({_id:id})){committed=true;break}await new Promise(r=>setTimeout(r,100))}
      assert.ok(committed,workerOutput);
      assert.equal(await canonicalCreatorStates.countDocuments({projectId:id}),1);
      assert.equal(await gate.states.countDocuments({projectId:id}),1);
      assert.equal(await provenance.ledger.countDocuments({projectId:id}),1);
      assert.equal(await projects.countDocuments({ownerId}),initialCount+1);
      assert.equal(await projects.countDocuments({_id:proposals.find(p=>p!==id)}),0);
      assert.equal(await registry.countDocuments({projectId:id}),1);
      // Registration appends one vault membership and provenance entry without changing active selection.
      const provisionedSelection=await selection.read({token:owner,projectId:selectionVaultId});
      assert.deepEqual(provisionedSelection,{...initialSelection,revision:initialSelection.revision+1});
      const provisionedVault=await gate.states.findOne({projectId:selectionVaultId,ownerId,revoked:false});
      assert.equal(provisionedVault.state.content.projects.filter(p=>p.id===id&&p.ownerId===ownerId).length,1);
      assert.equal(await provenance.ledger.countDocuments({projectId:selectionVaultId,operationId:'register:'+id}),1);
      assert.equal(await provenance.ledger.countDocuments({projectId:selectionVaultId,revision:provisionedSelection.revision,operationId:'register:'+id}),1);
      assert.deepEqual(await entitlement.findOne({principalId:ownerId}),initialBalance);
      assert.equal((await request('/studio/native-registration-complete',{projectId:concurrentId})).ok,false);
      assert.equal((await registrationIntents.findOne({ownerId})).projectId,id);
      worker.kill('SIGKILL');const exited=await workerExit;assert.equal(exited.signal,'SIGKILL');
      assert.deepEqual(await Promise.all(requests),[true,true]);
      proof={workerPid:address.pid,projectId:id,count:initialCount,consumed:initialBalance.consumedUnits,vaultId:selectionVaultId,previousSelection:initialSelection.activeProjectId,prior};
      console.log('GREEN PHYSICAL_CONCURRENT_INITIAL_CANONICAL_PROVISIONING_PROCESS_INTERRUPTION');
     }finally{if(worker.exitCode===null&&worker.signalCode===null)worker.kill('SIGKILL');await workerExit;try{unlinkSync(workerManifest)}catch{}}
     await freshBrowser.close();freshBrowser=null;freshVite.kill();freshVite=null;
     const resumed=spawnSync(process.execPath,['./verify-physical-native-film-registration.mjs'],{env:{...childEnv,NATIVE_INITIAL_PROVISION_RECOVERY:JSON.stringify(proof)},encoding:'utf8',timeout:60000});
     process.stdout.write(resumed.stdout||'');process.stderr.write(resumed.stderr||'');assert.equal(resumed.status,0,resumed.error?.message||resumed.stderr);
     // Two independent precommit kills: retain the original single-browser court first.
     for(const concurrent of [false,true]){
     const preCount=await projects.countDocuments({ownerId}),preBalance=await entitlement.findOne({principalId:ownerId});
     const preSelection=await selection.read({token:owner,projectId:selectionVaultId});
     const preVault=await gate.states.findOne({projectId:selectionVaultId,ownerId,revoked:false});
     const preLedger=await provenance.ledger.find({projectId:selectionVaultId}).sort({revision:1}).toArray();
     const prePrior=(await projects.find({ownerId}).toArray()).map(p=>({id:p._id,revision:p.revision,state:p.state}));
     const preManifest='./native-precommit-worker-'+randomUUID()+'.json',pauseManifest=preManifest+'.pause';
     const preWorker=spawn(process.execPath,['./verify-physical-native-film-registration.mjs'],{env:{...childEnv,NATIVE_INITIAL_PROVISION_WORKER:preManifest,NATIVE_PRECOMMIT_PAUSE:pauseManifest},stdio:['ignore','pipe','pipe']});
     let preOutput='';preWorker.stdout.on('data',x=>preOutput+=x);preWorker.stderr.on('data',x=>preOutput+=x);
     const preExit=new Promise(resolve=>preWorker.once('close',(status,signal)=>resolve({status,signal})));
     let preProof;
     try{
      const readSignal=async(path)=>{for(let i=0;i<150;i++){try{return JSON.parse(readFileSync(path,'utf8'))}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('worker signal missing: '+preOutput)};
      const address=await readSignal(preManifest);assert.equal(address.pid,preWorker.pid);
      const request=async(path,body,token=owner)=>{const r=await fetch('http://127.0.0.1:'+address.port+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return r.json()};
      const proposals=['movie-project-'+randomUUID(),'movie-project-'+randomUUID()];
      const intents=await Promise.all(proposals.map(projectId=>request('/studio/native-registration-intent',{projectId})));
      assert.ok(intents.every(i=>i.ok&&i.enabled));assert.equal(intents[0].projectId,intents[1].projectId);
      const id=intents[0].projectId;assert.ok(proposals.includes(id));
      const identity={domain:'iband.movie-mentor.project',schema:1,issuance:'secure-web-crypto',legacy:false};
      assert.equal((await request('/api/movie-mentor/projects',{projectId:id,identity})).success,true);
      const pending=await registrationIntents.findOne({ownerId});assert.equal(pending.projectId,id);
      const requests=[0,1].map(()=>request('/studio/native-film-register',{projectId:id}).then(()=>false,()=>true));
      const paused=await readSignal(pauseManifest);assert.equal(paused.pid,preWorker.pid);assert.equal(paused.projectId,id);assert.equal(paused.arrivals,2);
      assert.equal(await projects.countDocuments({_id:id}),0);
      assert.equal(await canonicalCreatorStates.countDocuments({projectId:id}),0);
      assert.equal(await provenance.ledger.countDocuments({projectId:id}),0);
      assert.equal((await request('/studio/native-registration-complete',{projectId:preSelection.activeProjectId})).ok,false);
      preWorker.kill('SIGKILL');assert.equal((await preExit).signal,'SIGKILL');
      assert.deepEqual(await Promise.all(requests),[true,true]);
      assert.equal(await projects.countDocuments({ownerId}),preCount);
      assert.equal(await gate.states.countDocuments({projectId:id}),0);
      assert.equal(await canonicalCreatorStates.countDocuments({projectId:id}),0);
      assert.equal(await provenance.ledger.countDocuments({projectId:id}),0);
      assert.equal(await registrationCompletions.countDocuments({ownerId,projectId:id}),0);
      assert.deepEqual(await gate.states.findOne({projectId:selectionVaultId,ownerId,revoked:false}),preVault);
      assert.deepEqual(await provenance.ledger.find({projectId:selectionVaultId}).sort({revision:1}).toArray(),preLedger);
      assert.deepEqual(await selection.read({token:owner,projectId:selectionVaultId}),preSelection);
      assert.deepEqual(await registrationIntents.findOne({ownerId}),pending);
      assert.deepEqual(await entitlement.findOne({principalId:ownerId}),preBalance);
      assert.equal(await registry.countDocuments({projectId:id}),1);
      for(const p of prePrior){const actual=await projects.findOne({_id:p.id});assert.equal(actual.revision,p.revision);assert.deepEqual(actual.state,p.state);}
      preProof={precommit:true,concurrent,abandonedSessionId:paused.sessionId,workerPid:address.pid,projectId:id,count:preCount,consumed:preBalance.consumedUnits,vaultId:selectionVaultId,previousSelection:preSelection.activeProjectId,selectionBefore:preSelection,prior:prePrior};
      console.log(concurrent?'GREEN PHYSICAL_CONCURRENT_BROWSER_PRECOMMIT_SIGKILL_ROLLBACK':'GREEN PHYSICAL_CONCURRENT_REGISTRATION_PRECOMMIT_SIGKILL_ROLLBACK');
     }finally{if(preWorker.exitCode===null&&preWorker.signalCode===null)preWorker.kill('SIGKILL');await preExit;for(const p of [preManifest,pauseManifest])try{unlinkSync(p)}catch{}}
     const preResumed=spawnSync(process.execPath,['./verify-physical-native-film-registration.mjs'],{env:{...childEnv,NATIVE_INITIAL_PROVISION_RECOVERY:JSON.stringify(preProof)},encoding:'utf8',timeout:180000});
     process.stdout.write(preResumed.stdout||'');process.stderr.write(preResumed.stderr||'');assert.equal(preResumed.status,0,preResumed.error?.message||preResumed.stderr);
     }





    }finally{if(freshBrowser)await freshBrowser.close();if(freshVite)freshVite.kill();for(const f of candidate.files)try{unlinkSync(f.path)}catch{}}

   }finally{if(freshExecutionServer)await new Promise(r=>freshExecutionServer.close(r));await new Promise(r=>providerServer.close(r));}

  }
 }else if(process.env.NATIVE_RECOVERY_PUBLIC_KEY){
  const expected=JSON.parse(process.env.EXPECTED_CONVERSATIONS);
  const transport=async({path,token,body})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return r.json()};
  const views=[];
  const factory=createApplicationStudioSessionFactory({transport,resolveSelectionVaultId:async({token})=>(await vaults.resolve({token})).vaultId,readLocalBytes:()=>'unchanged-local-bytes',onView:x=>views.push(x)});
  const session=factory({getAuthToken:async()=>owner}),opened=await session.open();assert.equal(opened.ok,true);
  const vaultId=(await vaults.resolve({token:owner})).vaultId;
  for(const x of [...expected].reverse()){
   assert.equal((await transport({path:'/studio/read',token:foreign,body:{projectId:x.projectId}})).ok,false);
   const current=await selection.read({token:owner,projectId:vaultId});
   const recovered=current.activeProjectId===x.projectId?
    await opened.services.applicationSecondFilm.reopen({token:owner,selectionVaultId:vaultId,projectId:x.projectId}):
    await opened.services.applicationSecondFilm.choose({token:owner,selectionVaultId:vaultId,nextProjectId:x.projectId,selectionOperationId:'restart-select-'+x.projectId,localMemory:{getState:()=>({})}});
   assert.equal(recovered.ok,true,JSON.stringify(recovered));
   assert.equal(recovered.view.writable,false);
   assert.deepEqual(recovered.view.conversationMessages,[x.creatorMessage,x.mentorMessage]);
   assert.deepEqual(views.at(-1).conversationMessages,[x.creatorMessage,x.mentorMessage]);
   assert.equal(await receipts.countDocuments({projectId:x.projectId}),1);
  }
  // Mount the pinned component with a restricted native read-only caller candidate.
  // Do not expose the old cockpit's local-write controls in this candidate.
  const base='native_conversation_recovery_'+randomUUID().replaceAll('-','');
  const root='../frontend/',component=root+'src/components/studio/'+base+'.jsx',entry=root+base+'.jsx',html=root+base+'.html',config=root+base+'.config.mjs';
  const files=[component,entry,html,config];
  let browser,vite;
  try{
   let source=readFileSync(root+'src/components/studio/CreatorWorkspace.jsx','utf8');
   function exact(from,to){assert.equal(source.split(from).length,2,'pinned native source drift: '+from);source=source.replace(from,to)}
   exact('import React, { useEffect, useMemo, useState }','import React, { useEffect, useMemo, useState, useRef }');
   exact('const CreatorWorkspace = ({ creatorName = "Creator",','const CreatorWorkspace = ({ nativeMovieService, creatorName = "Creator",');
   exact('const [movieMessages, setMovieMessages] = useState(resumeSnapshot?.conversationMessages || []);','const [movieMessages, setMovieMessages] = useState(nativeMovieService ? [] : resumeSnapshot?.conversationMessages || []);');
   exact('if (!resumeSnapshot?.projectId) return undefined;','if (nativeMovieService || !resumeSnapshot?.projectId) return undefined;');
   const anchor='  const activeCreator = useMemo(';
   exact(anchor,`  const nativeEpoch=useRef(0), nativePending=useRef(null);
  const [nativeProject,setNativeProject]=useState(null);
  const [nativeBusy,setNativeBusy]=useState(false);
  const [nativeError,setNativeError]=useState("");
  const [nativeWritable,setNativeWritable]=useState(false);
  const [nativeText,setNativeText]=useState("");
  const recoverNative=async(action,target)=>{
    const epoch=++nativeEpoch.current;
    setNativeBusy(true);setNativeError("");setMovieMessages([]);setNativeProject(null);setNativeWritable(false);
    try{
      const result=await nativeMovieService.run(action,target);
      if(epoch!==nativeEpoch.current)return;
      if(!result?.ok||!["read-only","server-editable"].includes(result.view?.mode)||!Array.isArray(result.view.conversationMessages))throw Error("native recovery denied");
      setNativeProject(result.view.projectId);setMovieMessages(result.view.conversationMessages);setNativeWritable(result.view.writable===true&&result.view.serverOwned===true);
      if(action==="create")nativePending.current=null;
    }catch{if(epoch===nativeEpoch.current)setNativeError("Movie recovery unavailable");}
    finally{if(epoch===nativeEpoch.current)setNativeBusy(false);}
  };
  useEffect(()=>{
    if(!nativeMovieService)return undefined;
    void recoverNative("resume");
    return ()=>{nativeEpoch.current++;};
  },[nativeMovieService]);
  const createNative=()=>{
    if(!nativePending.current){
      const id=globalThis.crypto?.randomUUID?.();
      if(!id){setNativeError("Secure identity unavailable");return;}
      nativePending.current="movie-project-"+id;
    }
    void recoverNative("create",nativePending.current);
  };
`+anchor);
   const render='  return (\n    <main style={styles.workspace}>';
   exact(render,`  if(nativeMovieService)return <main style={styles.workspace}>
    <h1>AI Movie Making</h1>
    <section aria-label="Recover an existing Movie Mentor project">
      <input aria-label="Existing movie project ID" value={recoveryProjectId} onChange={e=>{nativeEpoch.current++;setNativeBusy(false);setNativeProject(null);setMovieMessages([]);setNativeWritable(false);setRecoveryProjectId(e.target.value);}}/>
      <button type="button" disabled={nativeBusy} onClick={()=>void recoverNative("choose",recoveryProjectId.trim())}>Recover server-authorised film</button>
      <button type="button" disabled={nativeBusy} onClick={createNative}>Create new movie</button>
      <output aria-label="Verified native movie">{nativeProject||"none"}</output>
      <p>{nativeWritable?"Server writer admitted":"Read-only recovery. Editing remains blocked."}</p>
      <button type="button" disabled={nativeBusy||!nativeProject||nativeWritable} onClick={()=>void recoverNative("admit")}>Request native writing</button>
      <input aria-label="Native creator message" disabled={!nativeWritable||nativeBusy} value={nativeText} onChange={e=>setNativeText(e.target.value)}/>
      <button type="button" disabled={!nativeWritable||nativeBusy||!nativeText.trim()} onClick={()=>{const id=globalThis.crypto.randomUUID();void recoverNative("submit",{creatorMessage:{id,role:"creator",text:nativeText},mentorMessage:{id:globalThis.crypto.randomUUID(),role:"mentor",text:"Diagnostic mentor response",metadata:{backendMetadata:{creatorTurnId:id}}}});}}>Settle native conversation</button>
      {nativeError&&<p role="alert">{nativeError}</p>}
      <ol aria-label="Restored conversation">{movieMessages.map((m,i)=><li key={m.id||i}>{m.role}: {m.text}</li>)}</ol>
    </section>
  </main>;
`+render);
   writeFileSync(component,source);
   writeFileSync(entry,`import React from 'react';import {createRoot} from 'react-dom/client';import CreatorWorkspace from './src/components/studio/${base}.jsx';const nativeMovieService={run:(action,target)=>globalThis.nativeMovieRun(action,target)};createRoot(document.getElementById('root')).render(<CreatorWorkspace nativeMovieService={nativeMovieService}/>);`);
   writeFileSync(html,`<html><body><div id="root"></div><script type="module" src="/${base}.jsx"></script></body></html>`);
   writeFileSync(config,`import {defineConfig} from 'vite';import react from '@vitejs/plugin-react-swc';export default defineConfig({plugins:[react()]});`);
   vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port','52769','--strictPort','--config',base+'.config.mjs'],{cwd:root,stdio:['ignore','pipe','pipe']});
   let errors='';vite.stdout.on('data',x=>errors+=x);vite.stderr.on('data',x=>errors+=x);
   const url='http://127.0.0.1:52769/'+base+'.html';
   let ready=false;for(let i=0;i<100;i++){try{if((await fetch(url)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}
   assert.ok(ready,errors);
   const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
   const page=await browser.newPage();
   let browserSession=null;
   await page.exposeFunction('nativeMovieRun',async(action,target)=>{
    if(action==='resume'||!browserSession){browserSession?.invalidate();browserSession=factory({getAuthToken:async()=>owner});const r=await browserSession.open();if(!r.ok)return r}
    const app=browserSession.getServices();if(!app)return {ok:false};
    if(action==='admit'){
     const admitted=await app.applicationSecondFilm.requestEditing({token:owner,selectionVaultId:vaultId,operationId:'browser-admit-'+randomUUID()});
     assert.equal(admitted.ok,true,'native browser admission: '+JSON.stringify(admitted));
     return admitted;
    }
    if(action==='submit'){
     const settled=await app.submitNativeConversation(target);
     assert.equal(settled.ok,true,'native browser settlement: '+JSON.stringify(settled));
     return settled;
    }
    if(action==='create')return app.createNativeFilm({projectId:target,operationId:'browser-create-'+target});
    const current=await selection.read({token:owner,projectId:vaultId});
    const id=action==='resume'?current.activeProjectId:target;
    return current.activeProjectId===id?app.resumeNativeConversation({projectId:id}):app.applicationSecondFilm.choose({token:owner,selectionVaultId:vaultId,nextProjectId:id,selectionOperationId:'browser-switch-'+randomUUID(),localMemory:{getState:()=>({})}});
   });
   const poll=async(locator,expected)=>{for(let i=0;i<100;i++){if(await locator.count()&&(await locator.textContent())?.includes(expected))return;await new Promise(r=>setTimeout(r,100))}throw Error('browser projection missing '+expected+'; visible body: '+await page.locator('body').innerText())};
   await page.goto(url);
   const display=page.getByLabel('Restored conversation'),identity=page.getByLabel('Verified native movie');
   const first=expected[0],second=expected[1];
   await poll(identity,first.projectId);await poll(display,first.creatorMessage.text);
   await page.getByLabel('Existing movie project ID').fill(second.projectId);
   assert.equal(await display.textContent(),'');
   await page.getByRole('button',{name:'Recover server-authorised film'}).click();
   await poll(identity,second.projectId);await poll(display,second.mentorMessage.text);
   assert.ok(!(await display.textContent()).includes(first.creatorMessage.text));
   await page.reload();await poll(identity,second.projectId);await poll(display,second.creatorMessage.text);
   await page.getByRole('button',{name:'Create new movie'}).click();
   for(let i=0;i<100;i++){const id=await identity.textContent();if(id.startsWith('movie-project-')&&id!==second.projectId&&id!==first.projectId)break;await new Promise(r=>setTimeout(r,100))}
   const created=await identity.textContent();assert.match(created,/^movie-project-/);assert.notEqual(created,first.projectId);assert.notEqual(created,second.projectId);assert.equal(await display.textContent(),'');
   assert.equal(await registry.countDocuments({projectId:created}),1);
   await page.reload();await poll(identity,created);assert.equal(await display.textContent(),'');
   await page.getByRole('button',{name:'Request native writing'}).click();
   await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   await page.getByLabel('Native creator message').fill('Native browser conversation');
   await page.getByRole('button',{name:'Settle native conversation'}).click();
   await poll(display,'Native browser conversation');await poll(display,'Diagnostic mentor response');
   const browserReceipt=await receipts.findOne({projectId:created});assert.ok(browserReceipt?.commitId);
   assert.equal(await receipts.countDocuments({projectId:created}),1);
   const unchangedSelection=await selection.read({token:owner,projectId:vaultId});
   const firstRetired=await gate.admissions.findOne({projectId:created,fence:browserReceipt.fence});assert.equal(firstRetired.status,'retired');
   await page.getByRole('button',{name:'Request native writing'}).click();await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   dropNextConversationAck=true;
   await page.getByLabel('Native creator message').fill('Same film lost acknowledgement');
   await page.getByRole('button',{name:'Settle native conversation'}).click();await poll(display,'Same film lost acknowledgement');
   assert.equal(droppedAcks,1);
   assert.equal(await receipts.countDocuments({projectId:created}),2);
   assert.deepEqual(await selection.read({token:owner,projectId:vaultId}),unchangedSelection);
   const sameFilm=await projects.findOne({_id:created});assert.equal(sameFilm.revision,3);assert.equal(sameFilm.state.conversationMessages.length,4);
   const laterReceipt=await receipts.findOne({projectId:created,revision:3});assert.ok(laterReceipt);assert.notEqual(laterReceipt.fence,browserReceipt.fence);
   const stale={projectId:created,selectionVaultId:vaultId,operationId:browserReceipt.admissionId+':same-film-stale',creatorTurnId:'same-film-stale',expectedRevision:3,fence:browserReceipt.fence,creatorMessage:{id:'same-film-stale',role:'creator',text:'stale'},mentorMessage:{id:'same-film-stale-mentor',role:'mentor',text:'stale',metadata:{backendMetadata:{creatorTurnId:'same-film-stale'}}}};
   assert.equal((await transport({path:'/studio/native-conversation-settle',token:owner,body:stale})).ok,false);
   assert.equal((await transport({path:'/studio/native-conversation-retire',token:foreign,body:{projectId:created,selectionVaultId:vaultId,operationId:laterReceipt.operationId,fence:laterReceipt.fence,serverCommitId:laterReceipt.commitId}})).ok,false);
   await page.reload();await poll(identity,created);await poll(display,'Native browser conversation');
   await page.getByLabel('Existing movie project ID').fill(first.projectId);
   await page.getByRole('button',{name:'Recover server-authorised film'}).click();await poll(identity,first.projectId);await poll(display,first.mentorMessage.text);
   assert.ok(!(await display.textContent()).includes(second.creatorMessage.text));
   const retired=await gate.admissions.findOne({projectId:created,fence:browserReceipt.fence});assert.equal(retired.status,'retired');
   await page.getByLabel('Existing movie project ID').fill(created);
   await page.getByRole('button',{name:'Recover server-authorised film'}).click();await poll(identity,created);await poll(display,'Native browser conversation');
   const oldWrite={projectId:created,selectionVaultId:vaultId,operationId:browserReceipt.admissionId+':stale',creatorTurnId:'stale',expectedRevision:2,fence:browserReceipt.fence,creatorMessage:{id:'stale',role:'creator',text:'stale'},mentorMessage:{id:'stale-mentor',role:'mentor',text:'stale',metadata:{backendMetadata:{creatorTurnId:'stale'}}}};
   assert.equal((await transport({path:'/studio/native-conversation-settle',token:owner,body:oldWrite})).ok,false);
   await page.getByRole('button',{name:'Request native writing'}).click();await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   await page.getByLabel('Native creator message').fill('Renewed native conversation');
   await page.getByRole('button',{name:'Settle native conversation'}).click();await poll(display,'Renewed native conversation');
   assert.equal(await receipts.countDocuments({projectId:created}),3);
   assert.equal((await projects.findOne({_id:created})).state.conversationMessages.length,6);
   // Commit through HTTP, destroy the acknowledgement and discard the old application
   // session before its receipt/retirement path can run. No pending input is passed
   // into the next session. The actual pinned browser reload supplies only selection.
   await page.getByRole('button',{name:'Request native writing'}).click();await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   const stranded=browserSession.getServices().getContinuity();
   const turn=randomUUID(),interrupted={projectId:created,selectionVaultId:vaultId,operationId:stranded.operationId+':'+turn,creatorTurnId:turn,expectedRevision:4,fence:stranded.fence,creatorMessage:{id:turn,role:'creator',text:'Interrupted session committed conversation'},mentorMessage:{id:randomUUID(),role:'mentor',text:'Durable interrupted mentor response',metadata:{backendMetadata:{creatorTurnId:turn}}}};
   assert.equal((await transport({path:'/studio/native-conversation-recover',token:owner,body:{projectId:created,selectionVaultId:vaultId}})).reason,'unsettled-writer-held');
   dropNextConversationAck=true;
   await assert.rejects(transport({path:'/studio/native-conversation-settle',token:owner,body:interrupted}));
   assert.equal(droppedAcks,2);
   assert.equal(await receipts.countDocuments({projectId:created}),4);
   assert.equal((await gate.admissions.findOne({projectId:created,fence:stranded.fence})).status,'admitted');
   assert.equal((await transport({path:'/studio/native-conversation-recover',token:foreign,body:{projectId:created,selectionVaultId:vaultId}})).ok,false);
   browserSession.invalidate();browserSession=null;
   await page.reload();await poll(identity,created);await poll(display,'Interrupted session committed conversation');await poll(display,'Durable interrupted mentor response');
   assert.equal((await gate.admissions.findOne({projectId:created,fence:stranded.fence})).status,'retired');
   assert.equal(await receipts.countDocuments({projectId:created}),4);
   const again=await browserSession.getServices().resumeNativeConversation({projectId:created});assert.equal(again.ok,true);assert.equal(again.recovered,false);
   assert.equal((await transport({path:'/studio/native-conversation-settle',token:owner,body:interrupted})).ok,false);
   await page.getByRole('button',{name:'Request native writing'}).click();await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   await page.getByLabel('Native creator message').fill('Fresh session continuation');
   await page.getByRole('button',{name:'Settle native conversation'}).click();await poll(display,'Fresh session continuation');
   assert.equal(await receipts.countDocuments({projectId:created}),5);
   const finalProject=await projects.findOne({_id:created});assert.equal(finalProject.revision,6);assert.equal(finalProject.state.conversationMessages.length,10);
   console.log('GREEN PHYSICAL_NATIVE_INTERRUPTED_SESSION_DURABLE_RECEIPT_RECONSTRUCTION_AND_CONTINUATION');
   // Distinguish a never-committed admission from a completed stranded writer.
   // A fresh session must not automatically cancel; explicit cancellation is
   // revision-fenced and a delayed request from the retired writer must fail.
   await page.getByRole('button',{name:'Request native writing'}).click();await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   const abandoned=browserSession.getServices().getContinuity(),abandonedTurn=randomUUID();
   const abandonedWrite={projectId:created,selectionVaultId:vaultId,operationId:abandoned.operationId+':'+abandonedTurn,creatorTurnId:abandonedTurn,expectedRevision:6,fence:abandoned.fence,creatorMessage:{id:abandonedTurn,role:'creator',text:'Never committed'},mentorMessage:{id:randomUUID(),role:'mentor',text:'Never committed response',metadata:{backendMetadata:{creatorTurnId:abandonedTurn}}}};
   const beforeCancel=await selection.read({token:owner,projectId:vaultId});
   const cancellation={projectId:created,selectionVaultId:vaultId,expectedSelectionRevision:beforeCancel.revision,expectedRevision:6,confirmCancellation:true};
   browserSession.invalidate();browserSession=null;
   await page.reload();await poll(page.getByRole('alert'),'Movie recovery unavailable');
   const fresh=browserSession.getServices();assert.ok(fresh);
   assert.equal((await gate.admissions.findOne({projectId:created,fence:abandoned.fence})).status,'admitted');
   assert.equal((await fresh.cancelNativeUncommittedConversation({projectId:created})).ok,false);
   assert.equal((await transport({path:'/studio/native-conversation-cancel',token:foreign,body:cancellation})).ok,false);
   assert.equal((await transport({path:'/studio/native-conversation-cancel',token:owner,body:{...cancellation,expectedRevision:5}})).ok,false);
   const cancelled=await fresh.cancelNativeUncommittedConversation({projectId:created,confirmCancellation:true});
   assert.equal(cancelled.ok,true,JSON.stringify(cancelled));assert.equal(cancelled.view.writable,false);
   assert.equal((await gate.admissions.findOne({projectId:created,fence:abandoned.fence})).retirementReason,'explicit-uncommitted-conversation-cancellation');
   assert.deepEqual(await projects.findOne({_id:created}),finalProject);
   assert.equal(await receipts.countDocuments({projectId:created}),5);
   assert.equal((await transport({path:'/studio/native-conversation-settle',token:owner,body:abandonedWrite})).ok,false);
   await page.reload();await poll(identity,created);await poll(display,'Fresh session continuation');
   await page.getByRole('button',{name:'Request native writing'}).click();await poll(page.getByText('Server writer admitted',{exact:true}),'Server writer admitted');
   await page.getByLabel('Native creator message').fill('After explicit cancellation');
   await page.getByRole('button',{name:'Settle native conversation'}).click();await poll(display,'After explicit cancellation');
   assert.equal(await receipts.countDocuments({projectId:created}),6);
   assert.equal((await projects.findOne({_id:created})).revision,7);
   assert.equal((await projects.findOne({_id:created})).state.conversationMessages.length,12);
   assert.equal((await transport({path:'/studio/native-conversation-settle',token:owner,body:abandonedWrite})).ok,false);
   console.log('GREEN PHYSICAL_NATIVE_EXPLICIT_UNCOMMITTED_CANCELLATION_AND_STALE_WRITER_DENIAL');
   console.log('GREEN PHYSICAL_NATIVE_SAME_FILM_RENEWAL_AND_LOST_HTTP_ACK_RECEIPT_RECOVERY');
   browserSession?.invalidate();
   // Preserve the original Node-owned court above. Mount a second, genuinely
   // browser-owned composition through the pinned App /studio route.
   await page.close();
   const modules=['isolated-studio-server-selection-adoption.mjs','isolated-application-recovery-adoption-boundary.mjs','isolated-application-editable-adoption-boundary.mjs','isolated-studio-continuity-migration-candidate.mjs','isolated-application-owned-second-film-boundary.mjs','isolated-original-continuity-second-film-migration.mjs','isolated-application-owned-studio-service-composition.mjs','isolated-application-studio-async-clerk-session-adapter.mjs','isolated-application-studio-session-factory.mjs'];
   for(const module of modules){const dest=root+base+'_'+module;files.push(dest);let content=readFileSync('./'+module,'utf8');for(const dependency of modules)content=content.replaceAll("'./"+dependency+"'","'./"+base+'_'+dependency+"'");writeFileSync(dest,content)}
   const appPath=root+'src/'+base+'_App.jsx',shellPath=root+'src/components/studio/mentor/StudioRouteAuthorityShell.jsx',lifecyclePath=root+'src/components/studio/mentor/MovieMentorStudioRouteLifecycle.mjs';
   files.push(appPath,shellPath,lifecyclePath);
   const {transformPinnedStudioRouteToAuthorityShell}=await import('../scripts/isolated-pinned-studio-route-authority-candidate.mjs');
   let pinnedApp=transformPinnedStudioRouteToAuthorityShell(readFileSync(root+'src/App.jsx','utf8'));
   const shellImport='import StudioRouteAuthorityShell from "./components/studio/mentor/StudioRouteAuthorityShell.jsx";';
   assert.equal(pinnedApp.split(shellImport).length,2);
   pinnedApp=pinnedApp.replace(shellImport,shellImport+'\nimport {createRouteSession,RouteWorkspace} from "../'+base+'.jsx";');
   const route='element={<StudioRouteAuthorityShell onGenerate={generateMovieMentorLiveResponse} />}';
   assert.equal(pinnedApp.split(route).length,2);
   writeFileSync(appPath,pinnedApp.replace(route,'element={<StudioRouteAuthorityShell onGenerate={generateMovieMentorLiveResponse} createSession={createRouteSession} WorkspaceComponent={RouteWorkspace} />}'));
   writeFileSync(shellPath,readFileSync('../scripts/isolated-studio-route-authority-react-shell.jsx','utf8'));
   writeFileSync(lifecyclePath,readFileSync('../scripts/isolated-studio-authority-route-lifecycle.mjs','utf8'));
   writeFileSync(entry,`import React,{useMemo} from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import App from './src/${base}_App.jsx';import CreatorWorkspace from './src/components/studio/${base}.jsx';import {createApplicationStudioSessionFactory} from './${base}_isolated-application-studio-session-factory.mjs';import {setMovieMentorCreatorAuthState,clearMovieMentorCreatorAuthState} from './src/components/studio/mentor/MovieMentorCreatorAuthenticationTransport.js';
const transport=async({path,token,body})=>{const r=await fetch('/native-authority'+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('native HTTP '+r.status);return r.json()};
const factory=createApplicationStudioSessionFactory({transport,resolveSelectionVaultId:async({token})=>{const proof=await transport({path:'/studio/selection-vault',token,body:{}});return proof?.ok===true?proof.vaultId:null},readLocalBytes:()=>JSON.stringify(localStorage.getItem('iband.creator-memory'))});
export function createRouteSession(auth){const session=factory(auth);globalThis.__nativeRouteSession=session;return session}
export function RouteWorkspace({nativeApplicationServices:app}){const nativeMovieService=useMemo(()=>({run:async(action,target)=>{const {token,selectionVaultId}=app.recoveryServices();if(action==='admit')return app.applicationSecondFilm.requestEditing({token,selectionVaultId,operationId:'browser-route-admit-'+crypto.randomUUID()});if(action==='submit')return app.submitNativeConversation(target);if(action==='create')return app.recoverDurableRegistration({projectId:target});if(action==='resume'){const recovery=await app.recoverDurableRegistration();if(!recovery.ok||recovery.pending)return recovery;}const current=await app.studioServices.request('/studio/selection-read',{projectId:selectionVaultId});const id=action==='resume'?current.activeProjectId:target;return current.activeProjectId===id?app.resumeNativeConversation({projectId:id}):app.applicationSecondFilm.choose({token,selectionVaultId,nextProjectId:id,selectionOperationId:'browser-route-switch-'+crypto.randomUUID(),localMemory:{getState:()=>({})}})}}),[app]);return <CreatorWorkspace nativeMovieService={nativeMovieService}/>;}
globalThis.__nativeSignIn=()=>setMovieMentorCreatorAuthState({isLoaded:true,isSignedIn:true,getToken:async()=>globalThis.__nativeToken});globalThis.__nativeSignOut=()=>clearMovieMentorCreatorAuthState();history.replaceState({},'', '/studio');createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);`);
   // Vite proxy config is set before restarting the disposable browser server.
   vite.kill();await new Promise(resolve=>{if(vite.exitCode!==null||vite.signalCode!==null)resolve();else vite.once('exit',resolve)});
   writeFileSync(config,`import {defineConfig} from 'vite';import react from '@vitejs/plugin-react-swc';export default defineConfig({plugins:[react()],server:{proxy:{'/native-authority':{target:'http://127.0.0.1:${server.address().port}',changeOrigin:true,rewrite:path=>path.replace(/^\\/native-authority/,'')}}}});`);
   vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port','52769','--strictPort','--config',base+'.config.mjs'],{cwd:root,stdio:['ignore','pipe','pipe']});
   let routeReady=false;for(let i=0;i<100;i++){try{if((await fetch(url)).ok){routeReady=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}assert.ok(routeReady);
   const routePage=await browser.newPage(),requests=[];
   routePage.on('request',r=>{if(r.url().includes('/native-authority/'))requests.push(r.url())});
   await routePage.goto(url);
   await routePage.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000});
   assert.equal(await routePage.getByLabel('Verified native movie').count(),0);
   await routePage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},foreign);
   await routePage.locator('[data-denial-reason="studio-auth-unverified"]').waitFor({state:'attached',timeout:15000});
   await routePage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
   const routeIdentity=routePage.getByLabel('Verified native movie'),routeDisplay=routePage.getByLabel('Restored conversation');
   await routeIdentity.waitFor({timeout:15000});
   await routePage.getByText('After explicit cancellation',{exact:false}).waitFor({timeout:15000});
   assert.equal(await routeIdentity.textContent(),created);
   const bytes=await routePage.evaluate(()=>localStorage.getItem('iband.creator-memory'));
   await routePage.getByRole('button',{name:'Create new movie'}).click();
   await routePage.waitForFunction(previous=>{const x=document.querySelector('[aria-label="Verified native movie"]')?.textContent;return x?.startsWith('movie-project-')&&x!==previous},created);
   const routeFilm=await routeIdentity.textContent();assert.equal(await registry.countDocuments({projectId:routeFilm}),1);
   await routePage.getByRole('button',{name:'Request native writing'}).click();
   await routePage.getByText('Server writer admitted',{exact:true}).waitFor();
   await routePage.getByLabel('Native creator message').fill('Browser owned Studio route conversation');
   await routePage.getByRole('button',{name:'Settle native conversation'}).click();
   await routeDisplay.getByText('creator: Browser owned Studio route conversation',{exact:true}).waitFor({timeout:15000});
   assert.equal(await receipts.countDocuments({projectId:routeFilm}),1);
   assert.equal((await projects.findOne({_id:routeFilm})).state.conversationMessages.length,2);
   // The diagnostic HTML is the entry document; history.replaceState sets
   // /studio for BrowserRouter. A raw reload of /studio serves Vite's default
   // index.html instead of this disposable entry. Revisit the same entry
   // document to create a fresh JS realm and mount the identical /studio route.
   const routeReloadErrors=[];routePage.on('pageerror',e=>routeReloadErrors.push(String(e)));
   await routePage.goto(url,{waitUntil:'domcontentloaded'});
   try{await routePage.getByRole('status',{name:'Studio authority locked'}).waitFor({timeout:15000})}
   catch(e){throw Error('native route remount failed: '+routePage.url()+' errors='+JSON.stringify(routeReloadErrors)+' body='+await routePage.locator('body').innerText(),{cause:e})}
   assert.equal(new URL(routePage.url()).pathname,'/studio');
   assert.equal(await routePage.getByLabel('Verified native movie').count(),0);
   await routePage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
   await routePage.getByLabel('Restored conversation').getByText('creator: Browser owned Studio route conversation',{exact:true}).waitFor({timeout:15000});
   assert.equal(await routePage.getByLabel('Verified native movie').textContent(),routeFilm);
   assert.equal(await routePage.evaluate(()=>localStorage.getItem('iband.creator-memory')),bytes);
   for(const path of ['/studio/selection-vault','/api/movie-mentor/projects','/studio/native-conversation-settle','/studio/native-conversation-recover'])assert.ok(requests.some(x=>x.endsWith(path)),path);
   await routePage.evaluate(()=>{globalThis.__retainedNativeServices=globalThis.__nativeRouteSession.getServices();globalThis.__nativeSignOut()});
   await routePage.getByRole('status',{name:'Studio authority locked'}).waitFor();
   assert.equal(await routePage.getByLabel('Verified native movie').count(),0);
   assert.equal(await routePage.evaluate(()=>globalThis.__nativeRouteSession.getServices()),null);
   assert.equal(await routePage.evaluate(async()=> (await globalThis.__retainedNativeServices.resumeNativeConversation({projectId:'denied'})).ok),false);
   assert.equal(await receipts.countDocuments({projectId:routeFilm}),1);
   console.log('GREEN PHYSICAL_BROWSER_OWNED_NATIVE_STUDIO_ROUTE_CREATION_SETTLEMENT_RECOVERY_AUTH_DENIAL');
   await routePage.close();
   // Mount the pinned conversation core through the same native route.
   // Native mode is an explicit alternative to the legacy transport and
   // pending-storage wrapper, never a second writer.
   const corePath=root+'src/components/studio/mentor/'+base+'_Core.jsx';
   files.push(corePath);
   let core=readFileSync(root+'src/components/studio/mentor/MovieMentorConversationCore.jsx','utf8');
   function coreExact(from,to){assert.equal(core.split(from).length,2,'pinned core drift: '+from);core=core.replace(from,to)}
   coreExact('  onDemonstrate, onTeach, onContinue, onThinkingChange, renderComposerExtra, renderAboveConversation, renderBelowConversation,','  onDemonstrate, onTeach, onContinue, onThinkingChange, renderComposerExtra, renderAboveConversation, renderBelowConversation, nativeSubmit, nativeReadOnly = false,');
   coreExact('  const [draft, setDraft] = useState("");','  const [draft, setDraft] = useState("");\n  const nativeInFlight=useRef(false);\n  const [nativeFailure,setNativeFailure]=useState(false);');
   coreExact('if (!text || effectiveThinking || isGenerating) return; const creatorMessage',`if (!text || effectiveThinking || isGenerating || nativeReadOnly || nativeInFlight.current) return;
    if(typeof nativeSubmit==="function"){
      nativeInFlight.current=true;setLocalIsThinking(true);setNativeFailure(false);
      try{const result=await nativeSubmit(text);if(result?.ok!==true)throw Error("Native settlement not verified");setDraft("");}
      catch{setNativeFailure(true);}
      finally{nativeInFlight.current=false;setLocalIsThinking(false);}
      return;
    }
    const creatorMessage`);
   coreExact('disabled={effectiveThinking || isGenerating} style={styles.textarea}','disabled={nativeReadOnly || effectiveThinking || isGenerating} style={styles.textarea}');
   coreExact('disabled={!draft.trim() || effectiveThinking || isGenerating} style={styles.sendButton}','disabled={nativeReadOnly || !draft.trim() || effectiveThinking || isGenerating} style={styles.sendButton}');
   coreExact('{renderComposerExtra?.()}{renderBelowConversation?.()}','{nativeFailure&&<p role="alert">Conversation not confirmed. Recover the saved film before retrying.</p>}{renderComposerExtra?.()}{renderBelowConversation?.()}');
   coreExact('<div style={styles.viewport}>','<div style={styles.viewport} aria-label="Committed conversation transcript">');
   writeFileSync(corePath,core);
   // Preserve the restricted candidate; add a cockpit mode to a separate copy.
   const cockpitPath=root+'src/components/studio/'+base+'_Cockpit.jsx';
   files.push(cockpitPath);
   let cockpit=readFileSync(component,'utf8');
   function cockpitExact(from,to){assert.equal(cockpit.split(from).length,2,'native cockpit drift: '+from);cockpit=cockpit.replace(from,to)}
   cockpitExact('import MovieMentorConversation from "./mentor/MovieMentorConversation.jsx";','import MovieMentorConversation from "./mentor/MovieMentorConversation.jsx";\nimport NativeConversationCore from "./mentor/'+base+'_Core.jsx";');
   cockpitExact('const [nativeWritable,setNativeWritable]=useState(false);','const [nativeWritable,setNativeWritable]=useState(false);\n  const nativeSubmission=useRef(false);');
   const start=cockpit.indexOf('      <input aria-label="Native creator message"');
   const end=cockpit.indexOf('      {nativeError&&',start);
   assert.ok(start>=0&&end>start);
   cockpit=cockpit.slice(0,start)+`      <div aria-label="Native cockpit conversation"><NativeConversationCore key={nativeProject||"locked"} projectId={nativeProject} messages={movieMessages} showJourney={false} showStartPointChooser={false} allowAttachments={false} allowVoice={false} nativeReadOnly={!nativeWritable||nativeBusy} nativeSubmit={async(text)=>{
        if(nativeSubmission.current||!nativeWritable||nativeBusy||!nativeProject)return {ok:false};
        const epoch=nativeEpoch.current,projectId=nativeProject;
        nativeSubmission.current=true;setNativeError("");setNativeWritable(false);
        try{
          const id=globalThis.crypto.randomUUID();
          const result=await nativeMovieService.run("submit",{creatorMessage:{id,role:"creator",text},mentorMessage:{id:globalThis.crypto.randomUUID(),role:"mentor",text:"Diagnostic mentor response",metadata:{backendMetadata:{creatorTurnId:id}}}});
          if(epoch!==nativeEpoch.current||!result?.ok||result.view?.projectId!==projectId||result.view?.mode!=="read-only"||!Array.isArray(result.view.conversationMessages))return {ok:false};
          setMovieMessages(result.view.conversationMessages);
          return {ok:true};
        }catch{return {ok:false};}
        finally{nativeSubmission.current=false;}
      }}/></div>
`+cockpit.slice(end);
   // Do not expose duplicate history rendering in the cockpit court.
   cockpitExact('      <ol aria-label="Restored conversation">{movieMessages.map((m,i)=><li key={m.id||i}>{m.role}: {m.text}</li>)}</ol>','');
   writeFileSync(cockpitPath,cockpit);
   let cockpitEntry=readFileSync(entry,'utf8');
   const importOld="import CreatorWorkspace from './src/components/studio/"+base+".jsx';";
   assert.equal(cockpitEntry.split(importOld).length,2);
   cockpitEntry=cockpitEntry.replace(importOld,"import CreatorWorkspace from './src/components/studio/"+base+"_Cockpit.jsx';");
   writeFileSync(entry,cockpitEntry);
   const cockpitPage=await browser.newPage();
   await cockpitPage.goto(url);
   await cockpitPage.getByRole('status',{name:'Studio authority locked'}).waitFor();
   await cockpitPage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
   const cockpitRegion=cockpitPage.getByLabel('Native cockpit conversation');
   await cockpitRegion.getByText('Browser owned Studio route conversation',{exact:true}).waitFor({timeout:15000});
   const transcript=cockpitRegion.getByLabel('Committed conversation transcript');
   const composer=cockpitRegion.getByPlaceholder("Tell Movie Mentor what's on your mind...");
   assert.equal(await composer.isDisabled(),true);
   const cockpitBytes=await cockpitPage.evaluate(()=>JSON.stringify(Object.entries(localStorage).sort()));
   await cockpitPage.getByRole('button',{name:'Request native writing'}).click();
   await cockpitPage.getByText('Server writer admitted',{exact:true}).waitFor();
   await composer.fill('Genuine pinned composer native settlement');
   // Delay the physical settlement request and prove the UI has not published
   // an uncommitted creator message while the request is held.
   let release,heldResolve;const held=new Promise(r=>{heldResolve=r}),releaseGate=new Promise(r=>{release=r});
   await cockpitPage.route('**/native-authority/studio/native-conversation-settle',async route=>{heldResolve();await releaseGate;await route.continue()});
   await cockpitRegion.getByRole('button',{name:'Send',exact:true}).click();
   try{
     await Promise.race([held,new Promise((_,reject)=>setTimeout(()=>reject(Error('native composer did not send settlement')),10000))]);
     // The draft itself is intentionally retained in the disabled textarea.
     // Assert against the actual rendered conversation viewport, not the
     // entire region (Playwright can match textarea text content).
     assert.equal(await composer.inputValue(),'Genuine pinned composer native settlement');
     assert.equal(await transcript.getByText('Genuine pinned composer native settlement',{exact:true}).count(),0);
     assert.equal((await projects.findOne({_id:routeFilm})).state.conversationMessages.length,2);
     assert.equal(await receipts.countDocuments({projectId:routeFilm}),1);
     assert.equal(await composer.isDisabled(),true);
   }finally{release();}
   await transcript.getByText('Genuine pinned composer native settlement',{exact:true}).waitFor({timeout:15000});
   assert.equal(await receipts.countDocuments({projectId:routeFilm}),2);
   assert.equal((await projects.findOne({_id:routeFilm})).state.conversationMessages.length,4);
   assert.equal(await composer.isDisabled(),true);
   await cockpitPage.waitForFunction(()=>document.querySelector('[aria-label="Native cockpit conversation"] textarea')?.value==='');
   assert.equal(await transcript.getByText('Genuine pinned composer native settlement',{exact:true}).count(),1);
   assert.equal(await cockpitPage.evaluate(()=>JSON.stringify(Object.entries(localStorage).sort())),cockpitBytes);
   await cockpitPage.goto(url,{waitUntil:'domcontentloaded'});
   await cockpitPage.getByRole('status',{name:'Studio authority locked'}).waitFor();
   await cockpitPage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
   await transcript.getByText('Genuine pinned composer native settlement',{exact:true}).waitFor({timeout:15000});
   assert.equal(await transcript.getByText('Genuine pinned composer native settlement',{exact:true}).count(),1);
   assert.equal(await receipts.countDocuments({projectId:routeFilm}),2);
   await cockpitPage.evaluate(()=>globalThis.__nativeSignOut());
   await cockpitPage.getByRole('status',{name:'Studio authority locked'}).waitFor();
   assert.equal(await cockpitRegion.count(),0);
   await cockpitPage.close();
   console.log('GREEN PHYSICAL_PINNED_NATIVE_CONVERSATION_CORE_COMPOSER_ATOMIC_PUBLICATION_AND_RECOVERY');
   // New strict court: invoke the genuine pinned HTTP gateway with a local
   // provider, then independently reread canonical execution and accounting.
   // Existing fixture-based courts above remain unchanged.
   const {providerServer,providerRequests}=await startIsolatedProvider();
   let executionServer;
   try{
    // Provision the pinned backend's physical authority contracts in the disposable Mongo database.
    const authorityDb=mongoose.connection.db;
    assert.match(uri,/^mongodb:\/\/127\.0\.0\.1:27017\//);
    for(const requirement of [...EXECUTION_REQUIRED,...SETTLEMENT_REQUIRED])await authorityDb.collection(requirement.collection).createIndex(requirement.key,{unique:true});
    await authorityDb.collection('movie_mentor_provider_operation_reality').createIndex({providerCallId:1},{unique:true});
    await authorityDb.collection('movie_mentor_result_candidate').createIndex({candidateReference:1},{unique:true});
    for(const key of [{resultReference:1},{candidateReference:1},{executionId:1},{principalId:1,projectId:1,creatorTurnId:1},{reservationId:1}])await authorityDb.collection('movie_mentor_canonical_result').createIndex(key,{unique:true});
    await authorityDb.collection('movie_mentor_creator_state').createIndex({projectId:1},{unique:true,partialFilterExpression:{projectId:{$type:'string'}}});
    const {strict,hash,call,execution,server:composedServer}=await composeCanonicalExecution();executionServer=composedServer;
    const fresh=factory({getAuthToken:async()=>owner}),freshOpened=await fresh.open();assert.equal(freshOpened.ok,true);
    const service=freshOpened.services;
    assert.equal((await service.resumeNativeConversation({projectId:routeFilm})).ok,true);
    const admitted=await service.applicationSecondFilm.requestEditing({token:owner,selectionVaultId:vaultId,operationId:'strict-execution-'+randomUUID()});
    assert.equal(admitted.ok,true,JSON.stringify(admitted));
    const canonical=await provenance.states.findOne({projectId:routeFilm,ownerId,revoked:false});
    const admission=await gate.admissions.findOne({projectId:routeFilm,ownerId,fence:canonical.activeWriterFence,status:'admitted'});
    assert.ok(admission);
    const creatorTurnId=randomUUID(),message='isolated positive creator turn';
    const input={projectId:routeFilm,creatorTurnId,message,options:{}};
    const entitlements=mongoose.connection.db.collection('movie_mentor_inference_entitlement');
    await entitlements.insertOne({domain:'iband.movie-mentor.inference-spend',schema:1,principalId:ownerId,status:'active',remainingUnits:1,reservedUnits:0,consumedUnits:0,entitlementRevision:1});
    const creatorState=mongoose.connection.db.collection('movie_mentor_creator_state');
    await creatorState.createIndex({projectId:1},{unique:true,partialFilterExpression:{projectId:{$type:'string'}}});
    await creatorState.insertOne({projectId:routeFilm,revision:0,revisionAuthorityReference:'strict-'+creatorTurnId,creatorStateGeneration:1,creatorStateFingerprint:'strict-fingerprint-'+creatorTurnId,creatorAuthorityReference:'strict-authority-'+creatorTurnId,snapshotReference:'strict-snapshot-'+creatorTurnId,capturedAt:new Date()});
    const pair={selectionVaultId:vaultId,projectId:routeFilm,operationId:admission.operationId+':'+creatorTurnId,creatorTurnId,expectedRevision:canonical.revision,fence:admission.fence,creatorMessage:{id:creatorTurnId,role:'creator',text:message},mentorMessage:{id:randomUUID(),role:'mentor',text:'forged-before-execution',metadata:{backendMetadata:{creatorTurnId}}}};
    const before=await projects.findOne({_id:routeFilm});
    const submit=async(body,token=owner)=>(await call('/studio/strict-conversation-settle',body,token)).body;
    assert.equal((await submit(pair)).ok,false);
    assert.deepEqual(await projects.findOne({_id:routeFilm}),before);
    assert.notEqual((await call('/api/movie-mentor/turn',input,foreign)).status,200);
    const response=await call('/api/movie-mentor/turn',input);
    assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.success,true);assert.equal(response.body.status,'mentor-response-ready');
    assert.equal(providerRequests.length,5);
    assert.equal((await submit(pair)).ok,false);
    const genuine={...pair,mentorMessage:{...pair.mentorMessage,text:response.body.text}};
    assert.equal((await submit({...genuine,creatorMessage:{...genuine.creatorMessage,text:'altered request'}})).ok,false);
    assert.equal((await submit({...genuine,fence:'stale-fence'})).ok,false);
    assert.equal((await submit(genuine,foreign)).ok,false);
    assert.deepEqual(await projects.findOne({_id:routeFilm}),before);
    const replay=await call('/api/movie-mentor/turn',input);
    assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(replay.body.text,response.body.text);assert.equal(providerRequests.length,5);
    const committed=await submit(genuine);assert.equal(committed.ok,true,JSON.stringify(committed));
    const duplicate=await submit(genuine);assert.equal(duplicate.ok,true);assert.equal(duplicate.replay,true);assert.equal(duplicate.serverCommitId,committed.serverCommitId);
    assert.equal(await receipts.countDocuments({projectId:routeFilm}),3);
    assert.deepEqual((await projects.findOne({_id:routeFilm})).state.conversationMessages.slice(-2),[genuine.creatorMessage,genuine.mentorMessage]);
    assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,1);
    fresh.invalidate();
    const recovered=factory({getAuthToken:async()=>owner}),reopened=await recovered.open();assert.equal(reopened.ok,true);
    const restored=await reopened.services.resumeNativeConversation({projectId:routeFilm});assert.equal(restored.ok,true,JSON.stringify(restored));
    assert.deepEqual(restored.view.conversationMessages.slice(-2),[genuine.creatorMessage,genuine.mentorMessage]);
    assert.equal((await submit(genuine)).ok,false);assert.equal(await receipts.countDocuments({projectId:routeFilm}),3);
    recovered.invalidate();
    console.log('GREEN PHYSICAL_CANONICAL_MENTOR_EXECUTION_NATIVE_SETTLEMENT_FORGERY_REPLAY_AND_RECOVERY');
    // Independent browser adoption court. Keep the fixture and strict HTTP courts above.
    // The legacy composer path must fail here, before it can publish a fabricated response.
    const policy=await gate.states.updateOne({projectId:routeFilm,ownerId,revoked:false,activeWriterFence:{$exists:false}},{$set:{strictCanonicalConversation:true}});
    assert.equal(policy.modifiedCount,1,'strict policy must be durable before any strict writer admission');
    await registerCanonicalSubmission(strict,call);
    const strictCockpitPath=root+'src/components/studio/'+base+'_StrictCockpit.jsx';
    files.push(strictCockpitPath);
    const fixtureSubmit='const result=await nativeMovieService.run("submit",{creatorMessage:{id,role:"creator",text},mentorMessage:{id:globalThis.crypto.randomUUID(),role:"mentor",text:"Diagnostic mentor response",metadata:{backendMetadata:{creatorTurnId:id}}}});';
    assert.equal(cockpit.split(fixtureSubmit).length,2);
    writeFileSync(strictCockpitPath,cockpit.replace(fixtureSubmit,'const result=await nativeMovieService.run("submitCanonical",{creatorMessage:{id,role:"creator",text}});'));
    const strictEntry=cockpitEntry.replace(base+'_Cockpit.jsx',base+'_StrictCockpit.jsx').replace("if(action==='submit')return app.submitNativeConversation(target);","if(action==='submitCanonical')return app.submitNativeConversation(target,{canonical:true});if(action==='submit')return app.submitNativeConversation(target);");
    assert.notEqual(strictEntry,cockpitEntry);
    writeFileSync(entry,strictEntry);
    const canonicalPage=await browser.newPage();
    try{
     await canonicalPage.goto(url);
     await canonicalPage.getByRole('status',{name:'Studio authority locked'}).waitFor();
     await canonicalPage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
     const region=canonicalPage.getByLabel('Native cockpit conversation');
     const transcript=region.getByLabel('Committed conversation transcript');
     const composer=region.getByPlaceholder("Tell Movie Mentor what's on your mind...");
     await transcript.getByText(genuine.creatorMessage.text,{exact:true}).waitFor({timeout:15000});
     await canonicalPage.getByRole('button',{name:'Request native writing'}).click();
     await canonicalPage.getByText('Server writer admitted',{exact:true}).waitFor();
     const browserMessage='Canonical browser execution adoption '+randomUUID();
     const beforeBrowser=await projects.findOne({_id:routeFilm});
     const beforeBalance=await entitlements.findOne({principalId:ownerId});
     const beforeCalls=providerRequests.length;
     const beforeReceipts=await receipts.countDocuments({projectId:routeFilm});
     await entitlements.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
     let observed,release,signal;
     const initiationAttempts=[],settlementAttempts=[];
     let lostExecutionAck=false,lostSettlementAck=false;
     const observedRequest=new Promise(resolve=>{signal=resolve});
     const released=new Promise(resolve=>{release=resolve});
     await canonicalPage.route('**/native-authority/**',async route=>{
      const request=route.request(),path=new URL(request.url()).pathname.replace('/native-authority','');
      if(!observed&&['/studio/native-execution-initiate','/studio/native-conversation-settle','/studio/strict-conversation-settle','/api/movie-mentor/turn'].includes(path)){
       observed={path,body:request.postDataJSON()};
       signal();await released;
       if(path!=='/studio/native-execution-initiate'){await route.abort();return;}
      }
      if(path==='/studio/native-execution-initiate'){
       initiationAttempts.push(request.postDataJSON());
       if(!lostExecutionAck){
        const result=await route.fetch();assert.equal(result.ok(),true);
        const body=await result.json();assert.equal(body.ok,true,JSON.stringify(body));
        assert.equal(providerRequests.length,beforeCalls+5);
        assert.deepEqual(await projects.findOne({_id:routeFilm}),beforeBrowser);
        lostExecutionAck=true;await route.abort('failed');return;
       }
      }
      if(path==='/studio/strict-conversation-settle'){
       settlementAttempts.push(request.postDataJSON());
       if(!lostSettlementAck){
        const result=await route.fetch();assert.equal(result.ok(),true);
        const body=await result.json();assert.equal(body.ok,true,JSON.stringify(body));
        assert.equal(await receipts.countDocuments({projectId:routeFilm}),beforeReceipts+1);
        lostSettlementAck=true;await route.abort('failed');return;
       }
      }
      await route.continue();
     });
     await composer.fill(browserMessage);
     await region.getByRole('button',{name:'Send',exact:true}).click();
     try{
      await Promise.race([observedRequest,new Promise((_,reject)=>setTimeout(()=>reject(Error('canonical browser composer did not initiate execution')),10000))]);
      assert.equal(observed.path,'/studio/native-execution-initiate','genuine browser composer must initiate fenced canonical execution, not fixture settlement');
      assert.equal(observed.body.projectId,routeFilm);
      assert.equal(observed.body.creatorMessage?.text,browserMessage);
      assert.equal(observed.body.creatorMessage?.id,observed.body.creatorTurnId);
      assert.ok(observed.body.fence);
      assert.equal(Object.hasOwn(observed.body,'mentorMessage'),false);
      assert.equal(await transcript.getByText(browserMessage,{exact:true}).count(),0);
      assert.deepEqual(await projects.findOne({_id:routeFilm}),beforeBrowser);
      assert.equal(providerRequests.length,beforeCalls);
      const direct=async(body,token=owner)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/studio/native-execution-initiate',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return r.json()};
      const original=observed.body;
      for(const [body,token] of [[{...original,fence:'stale-fence'},owner],[original,foreign],[{...original,creatorMessage:{...original.creatorMessage,text:'altered request'}},owner],[{...original,mentorMessage:{text:'forged'}},owner]]){
       assert.equal((await direct(body,token)).ok,false);
      }
      assert.equal(providerRequests.length,beforeCalls);
      assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,beforeBalance.consumedUnits);
      console.log('GREEN PHYSICAL_NATIVE_EXECUTION_INITIATION_PRE_DISPATCH_DENIAL');
     }finally{release();}
     await transcript.getByText(browserMessage,{exact:true}).waitFor({timeout:20000});
     assert.equal(lostExecutionAck,true);assert.equal(lostSettlementAck,true);
     assert.equal(initiationAttempts.length,2);
     assert.deepEqual(initiationAttempts[0],initiationAttempts[1]);
     assert.equal(settlementAttempts.length,1);
     assert.equal(settlementAttempts[0].creatorTurnId,observed.body.creatorTurnId);
     assert.equal(settlementAttempts[0].operationId,observed.body.operationId);
     console.log('GREEN PHYSICAL_BROWSER_EXECUTION_AND_SETTLEMENT_ACK_LOSS_SAME_TURN_RECOVERY');
     const browserExecution=await authorityDb.collection('movie_mentor_inference_execution').findOne({principalId:ownerId,projectId:routeFilm,creatorTurnId:observed.body.creatorTurnId,phase:'settled'});
     assert.ok(browserExecution);
     const browserResult=await execution.authority.readCanonicalResult({executionId:browserExecution.executionId});
     assert.equal(browserResult.authorized,true);
     assert.equal(browserResult.requestDigest,buildRequestDigest({creatorMessage:browserMessage,projectId:routeFilm,options:{}}));
     const published=await projects.findOne({_id:routeFilm});
     assert.equal(published.revision,beforeBrowser.revision+1);
     assert.equal(published.state.conversationMessages.at(-2).text,browserMessage);
     assert.equal(published.state.conversationMessages.at(-1).text,browserResult.resultPayload.text);
     assert.equal(providerRequests.length,beforeCalls+5);
     assert.equal(await receipts.countDocuments({projectId:routeFilm}),beforeReceipts+1);
     assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,beforeBalance.consumedUnits+1);
     await canonicalPage.goto(url,{waitUntil:'domcontentloaded'});
     await canonicalPage.getByRole('status',{name:'Studio authority locked'}).waitFor();
     await canonicalPage.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
     await transcript.getByText(browserMessage,{exact:true}).waitFor({timeout:15000});
     assert.equal(await transcript.getByText(browserMessage,{exact:true}).count(),1);
     assert.equal(providerRequests.length,beforeCalls+5);
     assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,beforeBalance.consumedUnits+1);
     console.log('GREEN PHYSICAL_GENUINE_BROWSER_CANONICAL_EXECUTION_SETTLEMENT_AND_RELOAD');
     // Separate physical strict-mode bypass court, after all prior positive controls.
     await canonicalPage.unroute('**/native-authority/**');
     await canonicalPage.getByRole('button',{name:'Request native writing'}).click();
     await canonicalPage.getByText('Server writer admitted',{exact:true}).waitFor();
     const strictState=await gate.states.findOne({projectId:routeFilm,ownerId,revoked:false});
     const strictWriter=await gate.admissions.findOne({projectId:routeFilm,ownerId,fence:strictState.activeWriterFence,status:'admitted'});
     assert.ok(strictWriter);
     const bypassTurn=randomUUID(),bypassText='Strict composer bypass attempt';
     const bypass={selectionVaultId:vaultId,projectId:routeFilm,operationId:strictWriter.operationId+':'+bypassTurn,creatorTurnId:bypassTurn,expectedRevision:strictState.revision,fence:strictWriter.fence,creatorMessage:{id:bypassTurn,role:'creator',text:bypassText},mentorMessage:{id:randomUUID(),role:'mentor',text:'forged legacy response',metadata:{backendMetadata:{creatorTurnId:bypassTurn}}}};
     const bypassBefore=await projects.findOne({_id:routeFilm}),bypassReceipts=await receipts.countDocuments({projectId:routeFilm}),bypassCalls=providerRequests.length,bypassBalance=await entitlements.findOne({principalId:ownerId});
     const bypassResult=await canonicalPage.evaluate(async({body,token})=>{const response=await fetch('/native-authority/studio/native-conversation-settle',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return response.json()},{body:bypass,token:owner});
     assert.equal(bypassResult.ok,false,'strict writer must deny legacy settlement even before any canonical execution binding exists');
     assert.deepEqual(await projects.findOne({_id:routeFilm}),bypassBefore);
     assert.equal(await receipts.countDocuments({projectId:routeFilm}),bypassReceipts);
     assert.equal(providerRequests.length,bypassCalls);
     assert.deepEqual(await entitlements.findOne({principalId:ownerId}),bypassBalance);
     assert.equal(await transcript.getByText(bypassText,{exact:true}).count(),0);
     console.log('GREEN PHYSICAL_STRICT_BROWSER_LEGACY_SETTLEMENT_BYPASS_DENIAL');
     // A fully destroyed browser realm must recover a completed but unpublished turn.
     const interruptionMessage='Canonical execution completed before browser interruption '+randomUUID();
     await entitlements.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
     let notifyInterrupted,interruptedIntent;
     const interrupted=new Promise(resolve=>{notifyInterrupted=resolve});
     await canonicalPage.route('**/native-authority/studio/native-execution-initiate',async route=>{
      interruptedIntent=route.request().postDataJSON();
      const response=await route.fetch();assert.equal(response.ok(),true);
      const body=await response.json();assert.equal(body.ok,true,JSON.stringify(body));
      notifyInterrupted();await new Promise(resolve=>canonicalPage.once('close',resolve));
     });
     await composer.fill(interruptionMessage);
     await region.getByRole('button',{name:'Send',exact:true}).click();
     await Promise.race([interrupted,new Promise((_,reject)=>setTimeout(()=>reject(Error('interruption court did not reach canonical execution completion')),15000))]);
     assert.deepEqual(await projects.findOne({_id:routeFilm}),bypassBefore);
     assert.equal(await receipts.countDocuments({projectId:routeFilm}),bypassReceipts);
     assert.equal(providerRequests.length,bypassCalls+5);
     assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,bypassBalance.consumedUnits+1);
     assert.equal(await transcript.getByText(interruptionMessage,{exact:true}).count(),0);
     const boundVault=await gate.states.findOne({projectId:vaultId,ownerId,revoked:false});
     const boundCancel={projectId:routeFilm,selectionVaultId:vaultId,expectedRevision:interruptedIntent.expectedRevision,expectedSelectionRevision:boundVault.revision,confirmCancellation:true};
     const boundState=await gate.states.findOne({projectId:routeFilm,ownerId});
     const boundAdmission=await gate.admissions.findOne({projectId:routeFilm,ownerId,fence:interruptedIntent.fence});
     assert.equal((await transport({path:'/studio/native-conversation-cancel',token:owner,body:boundCancel})).ok,false,'a paid bound execution must not be discarded by cancellation');
     assert.deepEqual(await gate.states.findOne({projectId:routeFilm,ownerId}),boundState);
     assert.deepEqual(await gate.admissions.findOne({projectId:routeFilm,ownerId,fence:interruptedIntent.fence}),boundAdmission);
     assert.deepEqual(await projects.findOne({_id:routeFilm}),bypassBefore);
     assert.equal(await receipts.countDocuments({projectId:routeFilm}),bypassReceipts);
     console.log('GREEN PHYSICAL_BOUND_CANONICAL_EXECUTION_CANCELLATION_DENIAL');
     await canonicalPage.close();
     const restarted=await browser.newPage();
     try{
      await restarted.goto(url);
      await restarted.getByRole('status',{name:'Studio authority locked'}).waitFor();
      await restarted.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner);
      const restoredTranscript=restarted.getByLabel('Committed conversation transcript');
      await restoredTranscript.getByText(interruptionMessage,{exact:true}).waitFor({timeout:15000});
      assert.equal(await restoredTranscript.getByText(interruptionMessage,{exact:true}).count(),1);
      const recoveredProject=await projects.findOne({_id:routeFilm});
      assert.equal(recoveredProject.revision,bypassBefore.revision+1);
      assert.equal(recoveredProject.state.conversationMessages.at(-2).id,interruptedIntent.creatorTurnId);
      assert.equal(await receipts.countDocuments({projectId:routeFilm}),bypassReceipts+1);
      assert.equal(providerRequests.length,bypassCalls+5);
      assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,bypassBalance.consumedUnits+1);
      console.log('GREEN PHYSICAL_COMPLETE_BROWSER_INTERRUPTION_CANONICAL_UNPUBLISHED_TURN_RECOVERY');
      // Continue through the actual composer, not a synthetic settlement caller.
      await restarted.getByRole('button',{name:'Request native writing'}).click();
      await restarted.getByText('Server writer admitted',{exact:true}).waitFor();
      const continuationText='Genuine canonical continuation after recovered turn '+randomUUID();
      await entitlements.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
      const resumedRegion=restarted.getByLabel('Native cockpit conversation');
      await resumedRegion.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(continuationText);
      await resumedRegion.getByRole('button',{name:'Send',exact:true}).click();
      await restoredTranscript.getByText(continuationText,{exact:true}).waitFor({timeout:20000});
      assert.equal(await restoredTranscript.getByText(interruptionMessage,{exact:true}).count(),1);
      assert.equal(await restoredTranscript.getByText(continuationText,{exact:true}).count(),1);
      const continued=await projects.findOne({_id:routeFilm});
      assert.equal(continued.revision,recoveredProject.revision+1);
      assert.deepEqual(continued.state.conversationMessages.slice(0,-2),recoveredProject.state.conversationMessages);
      const continuedCreator=continued.state.conversationMessages.at(-2);
      assert.equal(continuedCreator.text,continuationText);
      const continuedExecution=await authorityDb.collection('movie_mentor_inference_execution').findOne({principalId:ownerId,projectId:routeFilm,creatorTurnId:continuedCreator.id,phase:'settled'});
      assert.ok(continuedExecution);
      const continuedResult=await execution.authority.readCanonicalResult({executionId:continuedExecution.executionId});
      assert.equal(continuedResult.authorized,true);
      assert.equal(continued.state.conversationMessages.at(-1).text,continuedResult.resultPayload.text);
      assert.equal(providerRequests.length,bypassCalls+10);
      assert.equal(await receipts.countDocuments({projectId:routeFilm}),bypassReceipts+2);
      assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,bypassBalance.consumedUnits+2);
      console.log('GREEN PHYSICAL_GENUINE_CANONICAL_COMPOSER_CONTINUATION_AFTER_UNPUBLISHED_RECOVERY');
      // Independent browser contexts must reconstruct the same pending conversation.
      await restarted.getByRole('button',{name:'Request native writing'}).click();
      await restarted.getByText('Server writer admitted',{exact:true}).waitFor();
      const concurrentText='Concurrent session recovery '+randomUUID();
      await entitlements.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
      let notifyConcurrent;
      const concurrentReady=new Promise(resolve=>{notifyConcurrent=resolve});
      await restarted.route('**/native-authority/studio/native-execution-initiate',async route=>{
       const response=await route.fetch();assert.equal(response.ok(),true);
       const body=await response.json();assert.equal(body.ok,true,JSON.stringify(body));
       notifyConcurrent();await new Promise(resolve=>restarted.once('close',resolve));
      });
      await resumedRegion.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(concurrentText);
      await resumedRegion.getByRole('button',{name:'Send',exact:true}).click();
      await Promise.race([concurrentReady,new Promise((_,reject)=>setTimeout(()=>reject(Error('concurrent recovery setup timed out')),15000))]);
      assert.deepEqual(await projects.findOne({_id:routeFilm}),continued);
      assert.equal(providerRequests.length,bypassCalls+15);
      assert.equal(await receipts.countDocuments({projectId:routeFilm}),bypassReceipts+2);
      await restarted.close();
      const peers=await Promise.all([browser.newPage(),browser.newPage()]);
      try{
       await Promise.all(peers.map(async page=>{await page.goto(url);await page.getByRole('status',{name:'Studio authority locked'}).waitFor();}));
       let arrived=0,releasePeers;
       const peerBarrier=new Promise(resolve=>{releasePeers=resolve});
       await Promise.all(peers.map(page=>page.route('**/native-authority/studio/native-conversation-recover',async route=>{
        arrived++;if(arrived===2)releasePeers();await peerBarrier;await route.continue();
       })));
       await Promise.all(peers.map(page=>page.evaluate(token=>{globalThis.__nativeToken=token;globalThis.__nativeSignIn()},owner)));
       await Promise.all(peers.map(async page=>{
        const history=page.getByLabel('Committed conversation transcript');
        await history.getByText(concurrentText,{exact:true}).waitFor({timeout:20000});
        assert.equal(await history.getByText(concurrentText,{exact:true}).count(),1);
        assert.equal(await history.getByText(continuationText,{exact:true}).count(),1);
       }));
       assert.equal(arrived,2);
       const concurrentProject=await projects.findOne({_id:routeFilm});
       assert.equal(concurrentProject.revision,continued.revision+1);
       assert.deepEqual(concurrentProject.state.conversationMessages.slice(0,-2),continued.state.conversationMessages);
       assert.equal(concurrentProject.state.conversationMessages.at(-2).text,concurrentText);
       assert.equal(await receipts.countDocuments({projectId:routeFilm}),bypassReceipts+3);
       assert.equal(providerRequests.length,bypassCalls+15);
       assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,bypassBalance.consumedUnits+3);
       console.log('GREEN PHYSICAL_CONCURRENT_BROWSER_CANONICAL_RECOVERY_EXACTLY_ONCE');
       const restartPage=peers[0];
       await restartPage.getByRole('button',{name:'Request native writing'}).click();
       await restartPage.getByText('Server writer admitted',{exact:true}).waitFor();
       const restartText='Independent server recovery '+randomUUID();
       await entitlements.updateOne({principalId:ownerId},{$inc:{remainingUnits:1,entitlementRevision:1}});
       let notifyRestart,restartIntent;
       const restartReady=new Promise(resolve=>{notifyRestart=resolve});
       await restartPage.route('**/native-authority/studio/native-execution-initiate',async route=>{
        restartIntent=route.request().postDataJSON();
        const response=await route.fetch();assert.equal(response.ok(),true);
        const body=await response.json();assert.equal(body.ok,true,JSON.stringify(body));
        notifyRestart();await new Promise(resolve=>restartPage.once('close',resolve));
       });
       const restartRegion=restartPage.getByLabel('Native cockpit conversation');
       await restartRegion.getByPlaceholder("Tell Movie Mentor what's on your mind...").fill(restartText);
       await restartRegion.getByRole('button',{name:'Send',exact:true}).click();
       await Promise.race([restartReady,new Promise((_,reject)=>setTimeout(()=>reject(Error('independent server recovery setup timed out')),15000))]);
       assert.deepEqual(await projects.findOne({_id:routeFilm}),concurrentProject);
       assert.equal(providerRequests.length,bypassCalls+20);
       assert.equal(await receipts.countDocuments({projectId:routeFilm}),bypassReceipts+3);
       await restartPage.close();
       // Stop both original HTTP listeners before the fresh process begins.
       const originalPort=server.address().port,originalExecutionPort=executionServer.address().port;
       await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));server=null;
       await new Promise((resolve,reject)=>executionServer.close(e=>e?reject(e):resolve()));executionServer=null;
       for(const port of [originalPort,originalExecutionPort]){
        await assert.rejects(fetch('http://127.0.0.1:'+port+'/studio/read',{method:'POST'}));
       }
       console.log('GREEN PHYSICAL_ORIGINAL_CANONICAL_HTTP_SERVERS_STOPPED');
       // A new OS process composes its own HTTP server and connects to the same disposable database.
       const expectedRestart={projectId:routeFilm,revision:concurrentProject.revision,history:concurrentProject.state.conversationMessages,creatorTurnId:restartIntent.creatorTurnId,text:restartText,receipts:bypassReceipts+3};
       if(process.env.NATIVE_DEFERRED_EXIT_MANIFEST){
        const pending=await projects.findOne({_id:routeFilm});
        assert.deepEqual(pending,concurrentProject);
        assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,bypassBalance.consumedUnits+4);
        writeFileSync(process.env.NATIVE_DEFERRED_EXIT_MANIFEST,JSON.stringify({...expectedRestart,originalPid:process.pid,consumedUnits:bypassBalance.consumedUnits+4,secondFilm:{projectId:created,project:await projects.findOne({_id:created}),receipts:await receipts.countDocuments({projectId:created})},browserCandidate:{base,files:files.map(path=>({path,content:readFileSync(path,'utf8')}))}}));
        console.log('GREEN PHYSICAL_CANONICAL_UNPUBLISHED_TURN_PRESERVED_BEFORE_PROCESS_EXIT');
       }else{
       const child=await new Promise((resolve,reject)=>{
        const p=spawn(process.execPath,['./verify-physical-native-film-registration.mjs'],{env:{...process.env,NATIVE_CANONICAL_RESTART_COURT:JSON.stringify(expectedRestart)},stdio:['ignore','pipe','pipe']});
        let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);
        const timer=setTimeout(()=>{p.kill();reject(Error('fresh server recovery court timed out'))},30000);
        p.on('error',e=>{clearTimeout(timer);reject(e)});p.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr})});
       });
       process.stdout.write(child.stdout);process.stderr.write(child.stderr);
       assert.equal(child.status,0,child.stderr);
       const afterRestart=await projects.findOne({_id:routeFilm});
       assert.equal(afterRestart.revision,concurrentProject.revision+1);
       assert.equal(afterRestart.state.conversationMessages.at(-2).id,restartIntent.creatorTurnId);
       assert.equal(await receipts.countDocuments({projectId:routeFilm}),bypassReceipts+4);
       assert.equal(providerRequests.length,bypassCalls+20);
       assert.equal((await entitlements.findOne({principalId:ownerId})).consumedUnits,bypassBalance.consumedUnits+4);
       console.log('GREEN PHYSICAL_INDEPENDENT_SERVER_RECOVERY_ACCOUNTING_EXACTLY_ONCE');
       // The outer supervisor will verify the original process has exited
       // and read the exact same committed conversation through a new server.
       if(process.env.NATIVE_POST_EXIT_MANIFEST){
        writeFileSync(process.env.NATIVE_POST_EXIT_MANIFEST,JSON.stringify({
         projectId:routeFilm,revision:afterRestart.revision,history:afterRestart.state.conversationMessages,
         receipts:bypassReceipts+4,consumedUnits:bypassBalance.consumedUnits+4,originalPid:process.pid
        }));
       }
       }
      }finally{await Promise.all(peers.map(page=>page.close()));}

     }finally{await restarted.close();}

    }finally{await canonicalPage.close();}

   }finally{if(executionServer)await new Promise(r=>executionServer.close(r));await new Promise(r=>providerServer.close(r));}
   console.log('GREEN PHYSICAL_NATIVE_BROWSER_WRITER_SETTLEMENT_RECEIPT_AND_RENEWAL');
   console.log('GREEN PHYSICAL_PINNED_CREATORWORKSPACE_NATIVE_READONLY_CONVERSATION_RELOAD_AND_CREATION');
  }finally{if(browser)await browser.close();if(vite)vite.kill();for(const f of files)try{unlinkSync(f)}catch{}}
  session.invalidate();assert.equal(session.getServices(),null);
  assert.equal(views.at(-1),null);
  console.log('GREEN PHYSICAL_NATIVE_FRESH_SERVER_AUTHENTICATED_TWO_FILM_CONVERSATION_PROJECTION');
 }else{
 const identity={domain:'iband.movie-mentor.project',schema:1,issuance:'secure-web-crypto',legacy:false};
 const create=(projectId,token=owner)=>fetch('http://127.0.0.1:'+server.address().port+'/api/movie-mentor/projects',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({projectId,identity})});
 const {vaultId}=await vaults.create({token:owner});assert.ok(vaultId);
 const filmA='movie-project-'+randomUUID(),filmB='movie-project-'+randomUUID();
 assert.equal((await registration.register({token:owner,projectId:filmA})).ok,false);
 assert.equal((await create(filmA)).status,201);
 assert.equal((await registration.register({token:owner,projectId:filmA})).ok,true);
 const history=[{role:'creator',text:'Midnight door'},{role:'mentor',text:'Opening scene'}];
 assert.equal((await provenance.append({token:owner,projectId:filmA,operationId:'film-a-conversation',expectedRevision:1,content:{scenes:[],conversationMessages:history}})).ok,true);
 await projects.updateOne({_id:filmA},{$set:{revision:2,state:{scenes:[],conversationMessages:history}}});
 const before=await provenance.states.findOne({projectId:filmA});
 assert.equal(await registry.countDocuments({projectId:filmB}),0);
 assert.equal(await projects.countDocuments({_id:filmB}),0);
 assert.equal((await create(filmB)).status,201);
 assert.equal((await create(filmB)).status,200);
 assert.equal((await create(filmB,foreign)).status,403);
 assert.equal((await registration.register({token:foreign,projectId:filmB})).ok,false);
 assert.deepEqual(await registration.register({token:owner,projectId:filmB}),{ok:true,projectId:filmB,replayed:false});
 assert.deepEqual(await registration.register({token:owner,projectId:filmB}),{ok:true,projectId:filmB,replayed:true});
 assert.equal(await registry.countDocuments({projectId:filmB}),1);
 assert.equal(await provenance.ledger.countDocuments({projectId:filmB}),1);
 const selected=await selection.read({token:owner,projectId:vaultId});
 assert.equal((await selection.select({token:owner,projectId:vaultId,operationId:'select-new-film',expectedRevision:selected.revision,nextActiveProjectId:filmB})).ok,true);
 assert.equal((await selection.read({token:owner,projectId:vaultId})).activeProjectId,filmB);
 assert.deepEqual((await projects.findOne({_id:filmB})).state,{scenes:[],conversationMessages:[]});
 assert.deepEqual(await provenance.states.findOne({projectId:filmA}),before);
 console.log('GREEN PHYSICAL_PINNED_NATIVE_HTTP_NEW_FILM_OWNERSHIP_REGISTRATION_SELECTION');
 console.log('GREEN PHYSICAL_NEW_FILM_EMPTY_HISTORY_ORIGINAL_FILM_UNCHANGED');
 const transport=async({path,token,body})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return r.json()};
 const factory=createApplicationStudioSessionFactory({transport,resolveSelectionVaultId:async({token})=>(await vaults.resolve({token})).vaultId,readLocalBytes:()=>'unchanged-local-bytes'});
 const session=factory({getAuthToken:async()=>owner});const opened=await session.open();assert.equal(opened.ok,true);
 const filmC='movie-project-'+randomUUID();
 assert.equal(await registry.countDocuments({projectId:filmC}),0);
 const newFilm=await opened.services.createNativeFilm({projectId:filmC,operationId:'select-film-c'});
 assert.equal(newFilm.ok,true,JSON.stringify(newFilm));assert.equal(newFilm.view.writable,false);
 assert.deepEqual((await projects.findOne({_id:filmC})).state,{scenes:[],conversationMessages:[]});
 assert.equal((await opened.services.createNativeFilm({projectId:filmC,operationId:'select-film-c'})).ok,true);
 assert.equal(await registry.countDocuments({projectId:filmC}),1);
 assert.equal(await provenance.ledger.countDocuments({projectId:filmC}),1);
 session.invalidate();
 assert.equal((await opened.services.createNativeFilm({projectId:'movie-project-'+randomUUID(),operationId:'stale'})).ok,false);
 const fresh=factory({getAuthToken:async()=>owner});const reopened=await fresh.open();assert.equal(reopened.ok,true);
 assert.equal((await reopened.services.applicationSecondFilm.reopen({token:owner,selectionVaultId:vaultId,projectId:filmC})).ok,true);
 const switchBack=await reopened.services.applicationSecondFilm.choose({token:owner,selectionVaultId:vaultId,nextProjectId:filmA,selectionOperationId:'return-film-a',localMemory:{getState:()=>({})}});
 assert.equal(switchBack.ok,true,JSON.stringify(switchBack));
 assert.deepEqual(await provenance.states.findOne({projectId:filmA}),before);
 console.log('GREEN PHYSICAL_AUTHENTICATED_APPLICATION_SESSION_NATIVE_CREATION_REPLAY_AND_SWITCH_BACK');
 const inputs=[];
 for(const [id,label] of [[filmB,'Second film only'],[filmC,'Third film only']]){
  const selected=await selection.read({token:owner,projectId:vaultId});
  assert.equal((await selection.select({token:owner,projectId:vaultId,expectedRevision:selected.revision,operationId:'conversation-select-'+id,nextActiveProjectId:id})).ok,true);
  const g=await provenance.issue({token:owner,projectId:id,revision:1});assert.ok(g?.grantId);
  const admissionId='conversation-admit-'+id;
  const admission=await gate.admit({token:owner,projectId:id,grantId:g.grantId,operationId:admissionId,revision:1});assert.equal(admission.acquired,true);
  const body={projectId:id,selectionVaultId:vaultId,operationId:admissionId+':turn',creatorTurnId:'same-turn-id',expectedRevision:1,fence:admission.fence,creatorMessage:{id:'same-turn-id',role:'creator',text:label},mentorMessage:{id:'same-mentor-id',role:'mentor',text:'Reply to '+label,metadata:{backendMetadata:{creatorTurnId:'same-turn-id'}}}};
  assert.equal((await transport({path:'/studio/native-conversation-settle',token:foreign,body})).ok,false);
  const result=await reopened.services.studioServices.request('/studio/native-conversation-settle',body);assert.equal(result.ok,true,JSON.stringify(result));
  const replay=await reopened.services.studioServices.request('/studio/native-conversation-settle',body);assert.equal(replay.replay,true);assert.equal(replay.serverCommitId,result.serverCommitId);
  assert.equal((await reopened.services.studioServices.request('/studio/native-conversation-settle',{...body,mentorMessage:{...body.mentorMessage,text:'tampered'}})).ok,false);
  assert.equal(await receipts.countDocuments({projectId:id}),1);
  assert.deepEqual((await projects.findOne({_id:id})).state.conversationMessages,[body.creatorMessage,body.mentorMessage]);
  inputs.push(body);
 }
 assert.equal((await reopened.services.studioServices.request('/studio/native-conversation-settle',inputs[0])).ok,false);
 assert.deepEqual(await provenance.states.findOne({projectId:filmA}),before);
 // Independent OS process reads the durable Mongo records, not the parent heap.
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import {MongoClient} from 'mongodb';const c=new MongoClient(process.env.MONGO_URI);await c.connect();try{const d=c.db('isolated_native_film_registration');for(const x of JSON.parse(process.env.EXPECTED_CONVERSATIONS)){const p=await d.collection('projects').findOne({_id:x.projectId});const s=await d.collection('provenance_states').findOne({projectId:x.projectId});assert.equal(p.revision,2);assert.deepEqual(p.state.conversationMessages,[x.creatorMessage,x.mentorMessage]);assert.deepEqual(s.state.content,p.state);assert.equal(await d.collection('native_conversation_receipts').countDocuments({projectId:x.projectId}),1)}}finally{await c.close()}`],{env:{...process.env,EXPECTED_CONVERSATIONS:JSON.stringify(inputs)},encoding:'utf8',timeout:30000});
 assert.equal(child.status,0,child.stderr||child.error?.message);
 console.log('GREEN PHYSICAL_NATIVE_TWO_FILM_ATOMIC_CONVERSATION_SETTLEMENT_AND_REPLAY');
 console.log('GREEN PHYSICAL_NATIVE_TWO_FILM_FRESH_PROCESS_DURABLE_READBACK');
 await new Promise(r=>server.close(r));server=null;
 const manifest=process.env.NATIVE_DEFERRED_EXIT_MANIFEST||'./native-post-exit-'+randomUUID()+'.json';
 const recoveryEnv={...process.env,NATIVE_RECOVERY_PUBLIC_KEY:publicKey.export({type:'spki',format:'pem'}),NATIVE_RECOVERY_OWNER_ID:ownerId,NATIVE_RECOVERY_OWNER_TOKEN:owner,NATIVE_RECOVERY_FOREIGN_TOKEN:foreign,EXPECTED_CONVERSATIONS:JSON.stringify(inputs)};
 try{
  const restarted=spawnSync(process.execPath,['./verify-physical-native-film-registration.mjs'],{env:{...recoveryEnv,NATIVE_POST_EXIT_MANIFEST:manifest},encoding:'utf8',timeout:180000});
  process.stdout.write(restarted.stdout||'');process.stderr.write(restarted.stderr||'');assert.equal(restarted.status,0,restarted.error?.message||restarted.stderr);
  const expected=JSON.parse(readFileSync(manifest,'utf8'));
  assert.equal(restarted.pid,expected.originalPid);
  const mode=process.env.NATIVE_DEFERRED_EXIT_MANIFEST?'NATIVE_CANONICAL_RESTART_COURT':'NATIVE_POST_EXIT_READBACK';
  const {browserCandidate,...restartExpected}=expected;
  const readback=spawnSync(process.execPath,['./verify-physical-native-film-registration.mjs'],{env:{...recoveryEnv,[mode]:JSON.stringify(restartExpected),...(browserCandidate?{NATIVE_RESTART_BROWSER_MANIFEST:manifest}:{})},encoding:'utf8',timeout:560000});
  process.stdout.write(readback.stdout||'');process.stderr.write(readback.stderr||'');assert.equal(readback.status,0,readback.error?.message||readback.stderr);
 }finally{try{unlinkSync(manifest)}catch{}}
 if(!process.env.NATIVE_DEFERRED_EXIT_MANIFEST){
  const deferredManifest='./native-deferred-exit-'+randomUUID()+'.json';
  try{
   const deferred=spawnSync(process.execPath,['./verify-physical-native-film-registration.mjs'],{env:{...process.env,NATIVE_DEFERRED_EXIT_MANIFEST:deferredManifest},encoding:'utf8',timeout:680000});
   process.stdout.write(deferred.stdout||'');process.stderr.write(deferred.stderr||'');assert.equal(deferred.status,0,deferred.error?.message||deferred.stderr);
  }finally{try{unlinkSync(deferredManifest)}catch{}}
 }
 console.log('HELD NATIVE_COCKPIT_EDITING_AND_REAL_ROUTE_SESSION_ADOPTION');
 }
}finally{if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();await client.close()}
