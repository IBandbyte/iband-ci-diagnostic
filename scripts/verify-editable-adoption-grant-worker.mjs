import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createGrantAuthority} from './isolated-editable-adoption-grant-authority.mjs';
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
await client.connect();
try{
 const db=client.db('isolated_editable_adoption_grant_court');
 const a=createGrantAuthority({db,client,publicKey:createPublicKey(process.env.PUBLIC_KEY_PEM)});
 const projectId='empty-outbox-grant-film',token=process.env.OWNER_TOKEN;
 const mode=process.argv[2];
 if(mode==='seed'){
  await a.grants.deleteMany({projectId});await a.states.deleteMany({projectId});
  await a.states.insertOne({projectId,ownerId:'owner-1',ownershipRevision:1,revoked:false,revision:1,state:{durablePublicationOutbox:[],content:'committed'}});
  const g1=await a.issue({token,projectId,revision:1}),g2=await a.issue({token,projectId,revision:1});
  assert.ok(g1&&g2);console.log(JSON.stringify({g1:g1.grantId,g2:g2.grantId}));
 }else if(mode==='consume'){
  const r=await a.consume({token,projectId,grantId:process.argv[3]});console.log(JSON.stringify(r));
 }else if(mode==='verify'){
  const state=await a.states.findOne({projectId});
  const consumed=await a.grants.countDocuments({projectId,status:'consumed'});
  assert.equal(consumed,1);assert.ok(state.activeAdoptionGrant);
  assert.equal((await a.consume({token,projectId,grantId:state.activeAdoptionGrant})).acquired,false);
  assert.equal((await a.issue({token:process.env.INTRUDER_TOKEN,projectId,revision:1})),null);
  assert.equal((await a.consume({token:process.env.INTRUDER_TOKEN,projectId,grantId:state.activeAdoptionGrant})).acquired,false);
  assert.deepEqual(state.state.durablePublicationOutbox,[]);
  console.log('GREEN ONE_REVISION_ONE_ADOPTER_REPLAY_INTRUDER_DENIED_EMPTY_OUTBOX');
 }else throw Error('unknown phase');
}finally{await client.close()}
