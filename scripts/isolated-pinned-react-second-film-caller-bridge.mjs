// Diagnostic source transformation: route the PINNED native Studio recovery
// button through the certified second-film caller, not ad-hoc local mutation.
// On independent restart, reopen the already server-selected project read-only.
import assert from 'node:assert/strict';
import {transformPinnedNativeRecoveryControls} from './isolated-pinned-native-studio-recovery-bridge.mjs';
export function transformPinnedMigratedSecondFilmRecovery(source){
 let migrated=transformPinnedNativeRecoveryControls(source);
 const start='      const opened = await controller.open({token, selectionVaultId});';
 const end='      setRecoveryStatus("preview-ready");';
 // The original native preview independently sets "preview-ready". Only
 // the inserted server-authorised handler is the intended projection boundary.
 const handlerStart='const requestVerifiedServerFilm = async () => {';
 const handlerEnd='const requestVerifiedServerEditing = async () => {';
 assert.equal(migrated.split(handlerStart).length,2,'pinned verified recovery handler drift');
 assert.equal(migrated.split(handlerEnd).length,2,'pinned verified editing handler drift');
 const scopeStart=migrated.indexOf(handlerStart);
 const scopeEnd=migrated.indexOf(handlerEnd,scopeStart);
 assert.ok(scopeEnd>scopeStart,'pinned verified handler order drift');
 const handler=migrated.slice(scopeStart,scopeEnd);
 assert.equal(handler.split(start).length,2,'pinned native opened boundary drift');
 assert.equal(handler.split(end).length,2,'pinned native projection boundary drift');
 const before=migrated.indexOf(start,scopeStart),after=migrated.indexOf(end,before);
 assert.ok(after>before && after<scopeEnd,'pinned native verified recovery order drift');
 const replacement=`      const oldProjectId = activeMovieProject?.id || null;
      const current = await controller.open({token,selectionVaultId});
      if (!current?.ok || !current.view?.projectId)
        throw Error("server-selection-denied");
      let recovered;
      if (current.view.projectId !== target) {
        const bridge = await globalThis.__migratedSecondFilmCaller({
          coordinator:controller,token,selectionVaultId,nextProjectId:target,
          selectionOperationId:"select-film-b",
          localMemory:{getState:()=>identityRuntime.getResumeSnapshot()},
          originalBytes:globalThis.__originalBrowserMemoryBytes,
          getLocalBytes:()=>globalThis.localStorage.getItem("iband.creator-memory")
        });
        if (!bridge?.ok || bridge.projectId !== target || bridge.writable !== false ||
            bridge.mode !== "read-only" || oldProjectId === target)
          throw Error("second-film-caller-denied");
        globalThis.__migratedSecondFilmPhysicalCalls=(globalThis.__migratedSecondFilmPhysicalCalls||0)+1;
        recovered={ok:true,view:controller.getSnapshot()};
      } else {
        // A restarted browser must re-read authoritative selection and film
        // without manufacturing a second selection receipt or writer grant.
        recovered=await controller.recover({token,selectionVaultId});
      }
      if (!recovered?.ok || recovered.view?.projectId !== target ||
          recovered.view?.mode !== "read-only" || recovered.view.writable !== false)
        throw Error("read-only-recovery-denied");
`;
 migrated=migrated.slice(0,before)+replacement+migrated.slice(after);
 assert.equal(migrated.split('globalThis.__migratedSecondFilmCaller(').length,2);
 assert.equal(migrated.split('const requestVerifiedServerEditing = async').length,2);
 return migrated;
}
