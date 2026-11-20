// Isolated HTTP-only adapter. Server-held JWT verifier, fence and Mongo handles never enter browser.
import {createServer} from 'node:http';
import {createFrontendContinuationCompatibility} from './isolated-frontend-continuation-compatibility.mjs';
const MAX_BODY=128*1024;
export function createIsolatedCreatorHttpServer({gate,editor,projectId,admissionOperationId}={}){
 return createServer(async(req,res)=>{
  const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body))};
  if(req.method!=='POST'||!['/creator/commit','/creator/read-committed'].includes(req.url))return reply(404,{error:'not-found'});
  const header=req.headers.authorization||'';
  if(!/^Bearer [A-Za-z0-9_.-]+$/.test(header))return reply(401,{error:'unauthorized'});
  const token=header.slice(7);
  if(!gate.authenticateOwner(token))return reply(401,{error:'unauthorized'});
  let raw='';try{
   for await(const chunk of req){raw+=chunk.toString();if(Buffer.byteLength(raw)>MAX_BODY)return reply(413,{error:'body-too-large'})}
   const input=JSON.parse(raw);
   if(!input||typeof input!=='object'||Array.isArray(input)||input.projectId!==projectId)return reply(400,{error:'invalid-request'});
   const admission=await gate.admissions.findOne({projectId,operationId:admissionOperationId,ownerId:gate.authenticateOwner(token),status:'admitted'});
   if(!admission)return reply(403,{error:'denied'});
   const adapter=createFrontendContinuationCompatibility({gate,editor,token,projectId,admissionOperationId,fence:admission.fence});
   const authenticatedSession={verifiedByServer:true};
   const result=req.url==='/creator/commit'
    ?await adapter.commit({authenticatedSession,...input})
    :await adapter.readCommitted({authenticatedSession,projectId:input.projectId,operationId:input.operationId});
   return result?reply(200,result):reply(403,{error:'denied'});
  }catch{return reply(400,{error:'invalid-request'})}
 });
}
