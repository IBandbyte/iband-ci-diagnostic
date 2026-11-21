import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=process.argv[2]||'frontend/src/components/studio';
const read=p=>readFileSync(root+'/'+p,'utf8');
const workspace=read('CreatorWorkspace.jsx');
const wrapper=read('mentor/MovieMentorConversation.jsx');
const core=read('mentor/MovieMentorConversationCore.jsx');
const runtime=read('mentor/MovieMentorStudioIdentityRuntime.js');
const memory=read('mentor/CreatorMemory.js');
const boundary=read('mentor/MovieMentorDurableCreatorWriteBoundary.js');
function check(label,conditions){for(const [what,ok] of conditions)assert.ok(ok,label+': '+what);console.log('GREEN '+label)}
check('PINNED_UI_WORKSPACE_CONVERSATION_MOUNT',[
 ['workspace mounts conversation',/<MovieMentorConversation\b/.test(workspace)],
 ['workspace forwards creator message',/recordPendingCreatorMessage\(/.test(workspace)],
 ['workspace settles mentor message',/settleConversationMessage\(/.test(workspace)]
]);
check('PINNED_UI_COMPOSER_REAL_SEND_PATH',[
 ['core handles send',/async function handleSend\(/.test(core)],
 ['core calls authoritative mentor turn',/requestMovieMentorTurn\(/.test(core)],
 ['core publishes message',/onSendMessage\?\.\(/.test(core)],
 ['core has Send button',/onClick=\{handleSend\}/.test(core)]
]);
check('PINNED_UI_WRAPPER_RECOVERY_PATH',[
 ['wrapper renders core',/<MovieMentorConversationCore\b/.test(wrapper)],
 ['wrapper passes publish handler',/onSendMessage=\{publishMessage\}/.test(wrapper)],
 ['wrapper protects pending recovery',/pendingCreatorTurnId/.test(wrapper)]
]);
check('PINNED_UI_STRICT_MEMORY_BOUNDARY',[
 ['runtime uses strict writer',/requireSharedWriteAuthority:\s*true/.test(runtime)],
 ['memory has server continuation',/continueWithDurableServerAuthority/.test(memory)],
 ['continuation does not adopt local state',/localStateAdopted:\s*false/.test(memory)],
 ['continuation stays read-only',/restorationMode:\s*["']server-read-only["']/.test(memory)],
 ['boundary has commit and readback',/authorityAdapter\.commit\(/.test(boundary)&&/authorityAdapter\.readCommitted\(/.test(boundary)]
]);
const visible=workspace+'\n'+wrapper+'\n'+core;
assert.ok(!/continueWithDurableServerAuthority\s*\(/.test(visible),'UI unexpectedly invokes server continuation: review contract before certification');
console.log('GREEN PINNED_VISIBLE_UI_NOT_YET_WIRED_TO_SERVER_CONTINUATION');
console.log('HELD ACTUAL_BROWSER_UI_SERVER_EDIT_AND_ORIGINAL_FRONTEND_RED');
