// Isolated Studio route lifetime gate. No React or browser dependency;
// the disposable JSX route shell drives this controller from auth events.
export function createStudioAuthorityRouteLifecycle({
  getAuthState,subscribeAuth,createSession,onReady,onDenied
}={}){
 if([getAuthState,subscribeAuth,createSession,onReady,onDenied].some(x=>typeof x!=='function'))
  throw Error('studio-route-lifecycle-dependencies-required');
 let epoch=0,session=null,readyServices=null,unsubscribe=null,active=false;
 const eligible=state=>state?.isLoaded===true&&state?.isSignedIn===true
   &&typeof state?.getToken==='function';
 const clear=()=>{
   epoch++;
   const prior=session;session=null;readyServices=null;
   try{prior?.invalidate()}catch{}
   onReady(null);
 };
 async function refresh(){
   clear();
   const own=epoch;
   if(!active)return;
   let state;
   try{state=getAuthState()}catch{onDenied('auth-state-unavailable');return;}
   if(!eligible(state)){onDenied('creator-authentication-required');return;}
   let candidate;
   try{candidate=createSession({getAuthToken:state.getToken});}
   catch{onDenied('studio-composition-unavailable');return;}
   if(!candidate||typeof candidate.open!=='function'||
      typeof candidate.invalidate!=='function'){
     onDenied('studio-composition-invalid');return;
   }
   session=candidate;
   let result;
   try{result=await candidate.open()}catch{result={ok:false,reason:'studio-auth-unavailable'}}
   if(!active||own!==epoch||session!==candidate){
     try{candidate.invalidate()}catch{};return;
   }
   let now;
   try{now=getAuthState()}catch{now=null}
   if(!eligible(now)||now.getToken!==state.getToken){
     clear();onDenied('creator-session-changed');return;
   }
   if(result?.ok!==true||!result.services){
     clear();onDenied('studio-auth-unverified');return;
   }
   readyServices=result.services;
   onReady(readyServices);
 }
 function start(){
   if(active)throw Error('studio-route-already-started');
   active=true;
   unsubscribe=subscribeAuth(()=>{void refresh()});
   if(typeof unsubscribe!=='function'){
     active=false;throw Error('studio-route-unsubscribe-required');
   }
   void refresh();
   return stop;
 }
 function stop(){
   active=false;
   const cleanup=unsubscribe;unsubscribe=null;
   try{cleanup?.()}finally{clear()}
 }
 return Object.freeze({start,stop,getCurrent:()=>readyServices});
}
