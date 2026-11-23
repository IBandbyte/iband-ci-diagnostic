import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformPinnedNativeRecoveryControls} from './isolated-pinned-native-studio-recovery-bridge.mjs';
import {transformPinnedFencedConversationHandler} from './isolated-pinned-fenced-conversation-handler-candidate.mjs';
const original=readFileSync('./frontend/src/components/studio/CreatorWorkspace.jsx','utf8');
const regression=readFileSync('./frontend/scripts/verify-movie-mentor-conversation-continuity.mjs','utf8');
const memory=readFileSync('./frontend/src/components/studio/mentor/CreatorMemory.js','utf8');
assert.match(regression,/assert\.equal\(cleared\.acquired, true\)/);
assert.match(memory,/publication-outbox-provenance-unverified/);
const withNative=transformPinnedNativeRecoveryControls(original);
const integrated=transformPinnedFencedConversationHandler(withNative);
assert.match(integrated,/const requestVerifiedServerFilm = async/);
assert.match(integrated,/const requestVerifiedServerEditing = async/);
assert.match(integrated,/onClick=\{requestServerRecovery\} disabled=\{recoveryStatus === "loading"\}/);
assert.match(integrated,/onClick=\{requestVerifiedServerFilm\}/);
assert.match(integrated,/onClick=\{requestVerifiedServerEditing\}/);
assert.match(integrated,/controller\.recover\(\{token,selectionVaultId\}\)/);
assert.match(integrated,/recovered\.view\.writable !== false/);
assert.match(integrated,/selected\?\.mode !== "read-only"/);
assert.match(integrated,/result\.view\?\.mode !== "server-editable"/);
assert.match(integrated,/result\.view\.projectId !== recoveryProjectId\.trim\(\)/);
assert.match(integrated,/__continuityView\?\.writable\?"writable":"blocked"/);
assert.match(integrated,/onSendMessage=\{handleMovieMessage\}/);
assert.doesNotMatch(integrated,/identityRuntime\.recordPendingCreatorMessage\(activeMovieProject\.id, message\)/);
assert.notEqual(integrated,original);
assert.equal(integrated.split('Recover movie preview').length,2);
assert.equal(integrated.split('Recover server-authorised film').length,2);
assert.equal(integrated.split('Request verified editing').length,2);
for(const broken of [
 original.replace('Recover movie preview','Unpinned recovery'),
 original.replace('const [serverRecoveredPreview, setServerRecoveredPreview] = useState(null);',''),
 original.replace('const activeCreator = useMemo(','const differentCreator = useMemo(')
]){
 assert.throws(()=>transformPinnedNativeRecoveryControls(broken),/pinned native Studio source drift/);
}
console.log('GREEN PINNED_NATIVE_RECOVERY_CONTROLS_SOURCE_EXACT_AND_ORIGINAL_PREVIEW_UNCHANGED');
console.log('GREEN PINNED_NATIVE_READ_ONLY_RECOVERY_SEPARATE_FROM_FENCED_EDITING');
console.log('GREEN PINNED_NATIVE_CREATOR_HANDLER_TRANSFORM_AND_ORIGINAL_FRONTEND_RED_PRESERVED');
console.log('HELD NATIVE_REACT_PHYSICAL_SERVER_RECEIPT_AND_RESTART_VERIFICATION');
