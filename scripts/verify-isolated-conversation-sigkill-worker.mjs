import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {validateConversationSettlement} from './isolated-conversation-settlement-contract.mjs';
const phase=process.argv[2],client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:10000});
const input={projectId:'kill-court-project',operationId:'kill-operation',creatorTurnId:'kill-turn',expectedRevision:0,creatorMessage:{id:'kill-turn',role:'creator',text:'Durable creator text'},mentorMessage:{id:'kill-mentor',role:'mentor',text:'Durable mentor text',metadata:{backendMetadata:{creatorTurnId:'kill-turn'}}}};
await client.connect();
const db=client.db('isolated_conversation_sigkill_court'),projects=db.collection('projects'),receipts=db.collection('receipts');
if(phase==='seed'){
 await projects.deleteMany({});await receipts.deleteMany({});
 await projects.insertOne({_id:input.projectId,ownerId:'owner-1',revision:0,conversation:[]});
 await receipts.createIndex({projectId:1,operationId:1},{unique:true});
 await receipts.createIndex({projectId:1,creatorTurnId:1},{unique:true});
 console.log('GREEN SIGKILL_COURT_SEEDED');await client.close();
}else if(phase==='before-commit'||phase==='after-commit'){
 const valid=validateConversationSettlement(input),session=client.startSession();
 try{
 await session.startTransaction({readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
 const project=await projects.findOne({_id:valid.projectId},{session});
 assert.equal(project.revision,0);
 const result=await projects.updateOne({_id:valid.projectId,revision:0},{$inc:{revision:1},$push:{conversation:{$each:[valid.creatorMessage,valid.mentorMessage]}}},{session});
 assert.equal(result.modifiedCount,1);
 await receipts.insertOne({projectId:valid.projectId,operationId:valid.operationId,creatorTurnId:valid.creatorTurnId,serverCommitId:'kill-commit',committedRevision:1},{session});
 if(phase==='before-commit'){console.log('READY_TO_KILL_BEFORE_COMMIT');process.stdout.write('');setInterval(()=>{},1000)}
 await session.commitTransaction();
 console.log('READY_TO_KILL_AFTER_COMMIT');setInterval(()=>{},1000);
 }catch(e){console.error(e);process.exitCode=1}
}else if(phase==='verify-rollback'){
 const project=await projects.findOne({_id:input.projectId}),count=await receipts.countDocuments({projectId:input.projectId});
 assert.equal(project.revision,0);assert.equal(project.conversation.length,0);assert.equal(count,0);
 console.log('GREEN SIGKILL_PRECOMMIT_NO_PARTIAL_CONVERSATION');await client.close();
}else if(phase==='recover'){
 const project=await projects.findOne({_id:input.projectId}),receipt=await receipts.findOne({projectId:input.projectId,operationId:input.operationId});
 assert.equal(project.revision,1);assert.equal(project.conversation.length,2);assert.equal(receipt.serverCommitId,'kill-commit');
 assert.deepEqual(project.conversation.map(x=>x.role),['creator','mentor']);
 const same=await receipts.findOne({projectId:input.projectId,operationId:input.operationId});
 assert.equal(same.serverCommitId,receipt.serverCommitId);assert.equal(await receipts.countDocuments({projectId:input.projectId}),1);
 console.log('GREEN SIGKILL_POSTCOMMIT_FRESH_PROCESS_DURABLE_REPLAY');
 console.log('GREEN SIGKILL_NO_DUPLICATE_SETTLEMENT');await client.close();
}else throw Error('unknown phase '+phase);
