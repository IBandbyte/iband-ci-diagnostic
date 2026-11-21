// Dedicated disposable HTTP server process for integrated React/HTTP/Mongo SIGKILL court.
import {MongoClient} from 'mongodb';
import {createPublicKey} from 'node:crypto';
import {createIsolatedConversationHttpAuthority} from './isolated-conversation-http-authority.mjs';
const mode=process.argv[2];
if(!['prekill','postkill','recover'].includes(mode))throw Error('invalid server mode');
const client=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:12000});
await client.connect();
const db=client.db(mode==='prekill'?'isolated_integrated_react_kill_pre':'isolated_integrated_react_kill_post');
const barrier=label=>async({operationId})=>{
 if(operationId!=='atomic-ui-operation')throw Error('unexpected-operation');
 console.log(label);
 await new Promise(()=>{});
};
const {server}=createIsolatedConversationHttpAuthority({
 db,client,publicKey:createPublicKey(process.env.PUBLIC_KEY_PEM),
 beforeCommitBarrier:mode==='prekill'?barrier('READY_TO_KILL_BEFORE_COMMIT'):null,
 afterCommitBarrier:mode==='postkill'?barrier('READY_TO_KILL_AFTER_COMMIT'):null
});
await new Promise(resolve=>server.listen(52760,'127.0.0.1',resolve));
console.log('INTEGRATED_SERVER_LISTENING '+mode);
