// Verifier-first source-exact application migration candidate; NOT an app-main adoption.
// Protect the original frontend regression while checking the isolated replacement
// includes real server-authorised selection and the fenced native handler.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformPinnedMigratedSecondFilmRecovery} from './isolated-pinned-react-second-film-caller-bridge.mjs';
import {transformPinnedFencedConversationHandler} from './isolated-pinned-fenced-conversation-handler-candidate.mjs';
import {inspectPinnedStudioMigration} from './isolated-pinned-studio-application-adoption-seams.mjs';

const workspace=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const originalContinuity=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
const originalMemory=readFileSync('./frontend/src/components/studio/mentor/CreatorMemory.js','utf8');
const originalBytes=Buffer.from(workspace);
const originalRegression=Buffer.from(originalContinuity);
const contract=inspectPinnedStudioMigration({
  workspace,continuityTest:originalContinuity,memory:originalMemory,
  frontEndSource:workspace
});
assert.equal(contract.ok,true,JSON.stringify(contract.failures));
assert.equal(workspace.includes('globalThis.__migratedSecondFilmCaller('),false,
  'pinned application already adopted caller; candidate must be re-audited');
assert.equal(workspace.includes('globalThis.__diagnosticFencedRequest('),false,
  'pinned application already adopted diagnostic request; candidate must be re-audited');
assert.match(originalContinuity,/assert\.equal\(cleared\.acquired, true\)/);
const candidate=transformPinnedFencedConversationHandler(
  transformPinnedMigratedSecondFilmRecovery(workspace));
assert.notEqual(candidate,workspace);
assert.equal(candidate.split('globalThis.__migratedSecondFilmCaller(').length,2);
assert.equal(candidate.split('const handleMovieMessage = (message) =>').length,2);
assert.equal(candidate.split('const requestVerifiedServerFilm = async () =>').length,2);
assert.equal(candidate.split('const requestVerifiedServerEditing = async () =>').length,2);
assert.match(candidate,/bridge\.writable !== false/);
assert.match(candidate,/recovered\.view\.writable !== false/);
assert.match(candidate,/__diagnosticFencedRequest\("\/studio\/fenced-save"/);
assert.match(candidate,/__diagnosticFencedRequest\("\/studio\/fenced-read-committed"/);
assert.match(candidate,/pending\.creator\.id/);
assert.match(candidate,/serverCommitId/);
assert.match(candidate,/The server result is unconfirmed/);
assert.match(candidate,/Recover movie preview/);
assert.match(candidate,/Existing movie project ID/);
assert.equal(Buffer.compare(originalBytes,Buffer.from(readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx'))),0);
assert.equal(Buffer.compare(originalRegression,Buffer.from(readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs'))),0);
assert.throws(()=>transformPinnedMigratedSecondFilmRecovery(
  workspace.replace('const [serverRecoveredPreview, setServerRecoveredPreview] = useState(null);',
  'const [serverRecoveredPreview, setServerRecoveredPreview] = useState(undefined);')),
 /pinned native Studio source drift/,
 'source drift must be denied, not silently rebased');
console.log('GREEN PINNED_SECOND_FILM_SOURCE_EXACT_ISOLATED_ADOPTION_CANDIDATE');
console.log('GREEN PINNED_NATIVE_RECOVERY_AND_FENCED_HANDLER_SOURCE_CONTRACT');
console.log('GREEN ORIGINAL_FRONTEND_LINE_71_AND_APPLICATION_SOURCE_UNMODIFIED');
console.log('HELD ACTUAL_FRONTEND_APPLICATION_ADOPTION_AND_ORIGINAL_LINE_71_RED');
