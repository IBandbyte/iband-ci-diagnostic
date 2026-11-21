// Browser-executed authenticated transport contract probe. No simulated server success:
 // requests are intercepted only to verify bearer/header/body shape and fail closed.
import {createBrowserCreatorHttpAdapter} from './isolated-browser-creator-http-adapter.mjs';
export async function probeBrowserTransport(){
 const calls=[];
 const adapter=createBrowserCreatorHttpAdapter({
  baseUrl:'https://isolated.invalid',
  getBearerToken:async()=> 'test-owner-jwt',
  fetchImpl:async(url,options)=>{
   calls.push({url,options});
   return {ok:false,status:403};
  }
 });
 let denied=false;
 try{await adapter.commit({projectId:'p',operationId:'op1',expectedRevision:2,proposedState:{content:'test'}})}catch(e){denied=e.message==='server-denied-or-unavailable'}
 if(!denied||calls.length!==1||calls[0].url!=='https://isolated.invalid/creator/commit'||calls[0].options.headers.authorization!=='Bearer test-owner-jwt')throw Error('browser-transport-not-fail-closed');
 return true;
}
