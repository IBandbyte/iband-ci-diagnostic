// Diagnostic-only source-exact /studio route adoption candidate.
// NEVER write this result into frontend/main without separate verification.
import assert from 'node:assert/strict';

export function transformPinnedStudioRouteToAuthorityShell(source) {
 const importAnchor='import generateMovieMentorLiveResponse from "./components/studio/mentor/MovieMentorLiveGatewayService.js";';
 const original='element={<CreatorWorkspace onGenerate={generateMovieMentorLiveResponse} />}';
 assert.equal(source.split(importAnchor).length,2,'pinned Studio imports changed');
 assert.equal(source.split(original).length,2,'pinned /studio route changed');
 assert.equal(source.split('path="/studio"').length,2,'pinned unique Studio route changed');
 assert.equal(source.includes('StudioRouteAuthorityShell'),false,'Studio route already altered');
 const candidate=source.replace(importAnchor,
  importAnchor+'\nimport StudioRouteAuthorityShell from "./components/studio/mentor/StudioRouteAuthorityShell.jsx";');
 const changed=candidate.replace(original,
  'element={<StudioRouteAuthorityShell onGenerate={generateMovieMentorLiveResponse} />}');
 assert.equal(changed.split('path="/studio"').length,2);
 assert.equal(changed.split('element={<StudioRouteAuthorityShell onGenerate={generateMovieMentorLiveResponse} />}').length,2);
 assert.equal(changed.split('element={<CreatorWorkspace onGenerate={generateMovieMentorLiveResponse} />}').length,1);
 assert.equal(changed.includes('<ClerkProvider'),false,'App.jsx is not auth provider');
 return changed;
}
