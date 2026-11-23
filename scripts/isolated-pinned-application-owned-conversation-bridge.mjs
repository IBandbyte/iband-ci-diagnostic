// Source-exact conversion of the isolated fenced conversation handler to
// application-owned injected services. The diagnostic browser globals remain
// test-harness wiring only; the actual pinned handler must not depend on them.
import assert from 'node:assert/strict';
import {sourceHandler} from './isolated-studio-real-handler-adoption-candidate.mjs';
export function transformPinnedApplicationOwnedConversationHandler(source){
 const signature='const CreatorWorkspace = ({ applicationSecondFilm, creatorName = "Creator",';
 assert.equal(source.split(signature).length,2,'pinned injected component signature drift');
 const match=source.match(sourceHandler);
 assert.ok(match,'pinned real conversation handler missing');
 const handler=match[0];
 const refs=[
  ['globalThis.__applicationEditable','studioServices.editable'],
  ['globalThis.__serverSelection','studioServices.selection'],
  ['globalThis.__diagnosticConversationPending','studioServices.pending'],
  ['globalThis.__diagnosticFencedRequest','studioServices.request']
 ];
 let patched=handler;
 for(const [legacy,injected] of refs){
   assert.ok(patched.includes(legacy),'pinned handler diagnostic seam drift: '+legacy);
   patched=patched.replaceAll(legacy,injected);
 }
 assert.doesNotMatch(patched,/globalThis\.__/,'no diagnostics globals in native conversation handler');
 assert.doesNotMatch(patched,/recordPendingCreatorMessage|settleConversationMessage/,
   'no legacy memory writes in server-fenced conversation');
 assert.match(patched,/studioServices\.editable\?\.getSnapshot/);
 assert.match(patched,/studioServices\.selection\?\.getSnapshot/);
 assert.match(patched,/studioServices\.request\("\/studio\/fenced-save"/);
 assert.match(patched,/studioServices\.request\("\/studio\/fenced-read-committed"/);
 assert.match(patched,/studioServices\.pending=null/);
 const next=source.replace(handler,patched).replace(signature,
  'const CreatorWorkspace = ({ applicationSecondFilm, studioServices, creatorName = "Creator",');
 assert.equal((next.match(/const handleMovieMessage = \(message\) =>/g)||[]).length,1);
 assert.equal(next.split('studioServices, creatorName = "Creator"').length,2);
 return next;
}
