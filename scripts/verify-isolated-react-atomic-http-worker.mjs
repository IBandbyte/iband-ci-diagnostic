// Independent process phases for physical atomic two-message HTTP authority court.
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createIsolatedConversationHttpAuthority} from './isolated-conversation-http-authority.mjs';
const phase=process.argv[2],projectId='react-atomic-http-project';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});await client.connect();
const db=client.db('isolated_react_atomic_http_court');
const op='react-atomic-turn-1',creatorTurnId='react-atomic-creator-1';
const creatorMessage={id:creatorTurnId,role:'creator',text:'Our first film scene'};
const mentorMessage={id:'react-atomic-mentor-1',role:'mentor',text:'Build the opening shot',metadata:{backendMetadata:{creatorTurnId}}};
const input={projectId,operationId:op,creatorTurnId,expectedRevision:0,creatorMessage,mentorMessage};
const {server,projects,receipts}=createIsolatedConversationHttpAuthority({db,client,publicKey:createPublicKey(process.env.PUBLIC_KEY_PEM),dropAfterCommitOperationId:phase==='socket'?op:null});
const send=async(base,path,token,body)=>{
 const res=await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
 return {status:res.status,data:await res.json()};
};
try{
 if(phase==='seed'){
  await projects.deleteMany({});await receipts.deleteMany({});
  await receipts.createIndex({projectId:1,operationId:1},{unique:true});
  await receipts.createIndex({projectId:1,creatorTurnId:1},{unique:true});
  await projects.insertOne({_id:projectId,ownerId:'owner-1',revision:0,conversation:[]});
  console.log('GREEN ATOMIC_REACT_HTTP_COURT_SEEDED');
 }else{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  if(phase==='socket'){
   let dropped=false;
   try{await send(base,'/conversation/settle',process.env.OWNER_TOKEN,input)}catch{dropped=true}
   assert.equal(dropped,true,'post-commit HTTP reply must be lost');
   assert.equal((await projects.findOne({_id:projectId})).revision,1);
   assert.equal(await receipts.countDocuments({projectId}),1);
   const denied=await send(base,'/conversation/read',process.env.INTRUDER_TOKEN,{projectId});
   assert.equal(denied.status,403);
   console.log('GREEN ATOMIC_REACT_HTTP_POSTCOMMIT_SOCKET_LOSS_DURABLE_TWO_MESSAGES');
   console.log('GREEN ATOMIC_REACT_HTTP_INTRUDER_DENIED');
  }else if(phase==='recover'){
   const restored=await send(base,'/conversation/read',process.env.OWNER_TOKEN,{projectId});
   assert.equal(restored.status,200);assert.equal(restored.data.revision,1);
   assert.deepEqual(restored.data.conversation,[creatorMessage,mentorMessage]);
   const previous=await send(base,'/conversation/receipt',process.env.OWNER_TOKEN,{projectId,operationId:op});
   assert.equal(previous.status,200);assert.equal(previous.data.committedRevision,1);
   const replay=await send(base,'/conversation/settle',process.env.OWNER_TOKEN,input);
   assert.equal(replay.status,200);assert.equal(replay.data.serverCommitId,previous.data.serverCommitId);
   assert.equal((await projects.findOne({_id:projectId})).conversation.length,2);
   assert.equal(await receipts.countDocuments({projectId}),1);
   console.log('GREEN ATOMIC_REACT_HTTP_FRESH_PROCESS_DURABLE_READBACK');
   console.log('GREEN ATOMIC_REACT_HTTP_EXACTLY_ONCE_REPLAY');
   const tamper=await send(base,'/conversation/settle',process.env.OWNER_TOKEN,{...input,mentorMessage:{...mentorMessage,text:'tampered'}});
   assert.equal(tamper.status,409);
   const invalid=await send(base,'/conversation/settle',process.env.INTRUDER_TOKEN,{...input,operationId:'intruder'});
   assert.equal(invalid.status,403);
   assert.equal(await receipts.countDocuments({projectId}),1);
   console.log('GREEN ATOMIC_REACT_HTTP_CONFLICTING_REPLAY_AND_INTRUDER_DENIED');
  }else throw Error('unknown phase '+phase);
 }
}finally{if(server.listening)await new Promise(resolve=>server.close(resolve));await client.close()}
