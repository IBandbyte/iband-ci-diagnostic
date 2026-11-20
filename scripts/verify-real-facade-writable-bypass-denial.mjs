import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectFencedRealFacade} from './isolated-real-facade-fenced-admission-inspection.mjs';
const {createCreatorMemory,createMemoryStorageAdapter}=await import(pathToFileURL(resolve('../frontend/src/components/studio/mentor/CreatorMemory.js')).href);
const storage=createMemoryStorageAdapter(),facade=createCreatorMemory({storageAdapter:storage,requireSharedWriteAuthority:true});
const before=JSON.stringify(facade.getState()),calls=[];
const gate={async readAdmission(input){calls.push(input);return {revision:3,fence:'fence-1',state:{...facade.getState(),durablePublicationOutbox:[{id:'publication-1',status:'pending',committedStateVersion:1,snapshotDigest:'a'.repeat(32)}]}}}};
const input={facade,gate,token:'signed-by-server',projectId:'project-1',operationId:'op-1',fence:'fence-1'};
const result=await inspectFencedRealFacade(input);
assert.equal(result.acquired,true);
assert.equal(result.localStateAdopted,false);
assert.equal(result.writable,false);
assert.equal(result.state.durablePublicationOutbox.length,1);
assert.equal(JSON.stringify(facade.getState()),before);
assert.equal(calls.length,1);
console.log('GREEN REAL_FACADE_REMOTE_NONEMPTY_SNAPSHOT_NOT_ADOPTED');
let denied=false;
try{facade.replaceState({...facade.getState(),durablePublicationOutbox:result.state.durablePublicationOutbox})}catch(e){denied=e.code==='CREATOR_MEMORY_WRITE_AUTHORITY_DENIED'||e.cause?.code==='CREATOR_MEMORY_WRITE_AUTHORITY_DENIED'}
assert.equal(denied,true,'strict synchronous local write must remain denied');
assert.equal(JSON.stringify(facade.getState()),before);
console.log('GREEN STRICT_FACADE_SYNCHRONOUS_WRITABLE_BYPASS_DENIED');
const fakeLocks={request:async(_name,_opts,fn)=>fn()};
let provenanceDenied=false;
try{
 await facade.replaceStateWithSharedAuthority({locks:fakeLocks,transform:state=>({...state,projects:[...(state.projects||[]),{id:'unauthorized'}]})});
}catch(e){provenanceDenied=e.code==='MOVIE_MENTOR_PUBLICATION_OUTBOX_PROVENANCE_UNVERIFIED'}
assert.equal(provenanceDenied,false,'empty local outbox may permit ordinary shared writer, but must not import server publication');
assert.equal(facade.getState().durablePublicationOutbox?.length||0,0);
console.log('GREEN SERVER_GRANT_CANNOT_PROMOTE_PUBLICATION_WITNESS');
console.log('HELD REAL_FACADE_WRITABLE_ADOPTION_AND_ORIGINAL_FRONTEND_RED');
