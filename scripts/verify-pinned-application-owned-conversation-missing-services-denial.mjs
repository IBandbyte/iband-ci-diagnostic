// Negative court: the real pinned conversation callback may not manufacture
// local writer access when the application-owned server services are absent.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {sourceHandler} from './isolated-studio-real-handler-adoption-candidate.mjs';
import {transformPinnedFencedConversationHandler} from './isolated-pinned-fenced-conversation-handler-candidate.mjs';
import {transformPinnedApplicationOwnedSecondFilmRecovery} from './isolated-pinned-application-owned-second-film-react-bridge.mjs';
import {transformPinnedApplicationOwnedConversationHandler} from './isolated-pinned-application-owned-conversation-bridge.mjs';
const original=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const regression=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
assert.match(regression,/assert\.equal\(cleared\.acquired, true\)/);
const adopted=transformPinnedApplicationOwnedConversationHandler(
 transformPinnedFencedConversationHandler(
 transformPinnedApplicationOwnedSecondFilmRecovery(original)));
const native=adopted.match(sourceHandler)?.[0];
assert.ok(native,'native handleMovieMessage source missing');
assert.doesNotMatch(native,/globalThis\.__|settleConversationMessage|recordPendingCreatorMessage/);
let status='idle',messages=0,requests=0;
const ctx={
 studioServices:null,activeMovieProject:{id:'film-b'},
 setProjectStatus:s=>{status=s},
 setMovieMessages:()=>{messages++},
 projectJourneySnapshot:null,projectJourney:null
};
const handler=runInNewContext('(()=>{'+native+';return handleMovieMessage})()',ctx);
handler({id:'creator-1',role:'creator',text:'Must remain unsaved'});
assert.equal(status,'error');
assert.equal(messages,0);
assert.equal(requests,0);
status='idle';
handler({id:'mentor-1',role:'mentor',text:'No unauthorised settlement'});
assert.equal(status,'error');
assert.equal(messages,0);
ctx.studioServices={editable:null,selection:null,request:()=>{requests++;throw Error('unexpected HTTP')}};
status='idle';
handler({id:'creator-2',role:'creator',text:'Missing server admission'});
assert.equal(status,'error');
assert.equal(messages,0);
assert.equal(requests,0);
assert.equal(readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8'),original);
assert.equal(readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8'),regression);
console.log('GREEN NATIVE_APPLICATION_OWNED_CONVERSATION_MISSING_SERVICES_FAIL_CLOSED');
console.log('GREEN ORIGINAL_FRONTEND_SOURCE_AND_LINE_71_REGRESSION_UNMODIFIED');
console.log('HELD REAL_APPLICATION_ADOPTION_AND_LINE_71_RED');
