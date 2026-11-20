// Isolated browser-shaped transport; no Mongo handle, fence or trusted principal enters this adapter.
// Authentication is independently checked by the server for every HTTP request.
export function createBrowserCreatorHttpAdapter({baseUrl,getBearerToken,fetchImpl=fetch}={}){
 if(typeof baseUrl!=='string'||!/^https?:\/\//.test(baseUrl)||typeof getBearerToken!=='function'||typeof fetchImpl!=='function')throw Error('invalid-transport');
 const send=async(path,body)=>{
  const token=await getBearerToken();
  if(typeof token!=='string'||!token)throw Error('missing-session-token');
  const response=await fetchImpl(baseUrl+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw Error('server-denied-or-unavailable');
  return response.json();
 };
 return Object.freeze({
  commit:({projectId,operationId,expectedRevision,proposedState})=>send('/creator/commit',{projectId,operationId,expectedRevision,proposedState}),
  readCommitted:({projectId,operationId})=>send('/creator/read-committed',{projectId,operationId}),
 });
}
