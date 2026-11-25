// Isolated React route shell candidate; no application-main adoption.
// The actual /studio route will eventually own the session factory, but may
// NEVER reveal CreatorWorkspace before authenticated services are verified.
import React, {useEffect,useState} from 'react';
import CreatorWorkspace from '../CreatorWorkspace.jsx';
import {
  getMovieMentorCreatorAuthState,
  subscribeMovieMentorCreatorAuthState
} from './MovieMentorCreatorAuthenticationTransport.js';
import {createStudioAuthorityRouteLifecycle} from './MovieMentorStudioRouteLifecycle.mjs';

export default function StudioRouteAuthorityShell({
  onGenerate,createSession,
  getAuthState=getMovieMentorCreatorAuthState,
  subscribeAuth=subscribeMovieMentorCreatorAuthState,
  WorkspaceComponent=CreatorWorkspace
}){
 const [services,setServices]=useState(null);
 const [denial,setDenial]=useState('creator-authentication-required');
 useEffect(()=>{
  if(typeof createSession!=='function'){
   setServices(null);setDenial('studio-composition-unavailable');
   return undefined;
  }
  let mounted=true;
  const lifecycle=createStudioAuthorityRouteLifecycle({
   getAuthState,subscribeAuth,createSession,
   onReady:next=>{if(mounted)setServices(next)},
   onDenied:reason=>{if(mounted){setServices(null);setDenial(reason)}}
  });
  const stop=lifecycle.start();
  return ()=>{mounted=false;stop()};
 },[createSession,getAuthState,subscribeAuth]);
 const valid=services?.applicationSecondFilm &&
   services?.studioServices?.editable &&
   services?.studioServices?.selection &&
   typeof services?.studioServices?.request==='function' &&
   typeof services?.recoveryServices==='function';
 if(!valid){
   return <section aria-label="Studio authority locked" role="status" data-authority="denied">
     Studio is unavailable until creator authentication and server authority are verified.
     <span data-denial-reason={denial}/>
   </section>;
 }
 return <WorkspaceComponent
   onGenerate={onGenerate}
   applicationSecondFilm={services.applicationSecondFilm}
   studioServices={services.studioServices}
   nativeApplicationServices={services}
   studioRecoveryServices={services.recoveryServices()}
 />;
}
