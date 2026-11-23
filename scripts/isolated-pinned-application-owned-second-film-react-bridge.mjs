// Isolated source-exact React migration candidate: route the real pinned
// recovery controls through a dependency-injected application-owned boundary.
// Keep original native preview, source and line-71 RED unmodified.
import assert from 'node:assert/strict';
import {transformPinnedMigratedSecondFilmRecovery} from './isolated-pinned-react-second-film-caller-bridge.mjs';
export function transformPinnedApplicationOwnedSecondFilmRecovery(source){
 let candidate=transformPinnedMigratedSecondFilmRecovery(source);
 const chooseStart='        const bridge = await globalThis.__migratedSecondFilmCaller({';
 const chooseEnd='        recovered={ok:true,view:controller.getSnapshot()};';
 assert.equal(candidate.split(chooseStart).length,2,'application-owned source choose anchor drift');
 assert.equal(candidate.split(chooseEnd).length,2,'application-owned source choose completion drift');
 const start=candidate.indexOf(chooseStart),end=candidate.indexOf(chooseEnd,start)+chooseEnd.length;
 const choose=`        const bridge = await applicationSecondFilm.choose({
          token,selectionVaultId,nextProjectId:target,
          selectionOperationId:"select-film-b",
          localMemory:{getState:()=>identityRuntime.getResumeSnapshot()}
        });
        if (!bridge?.ok || bridge.view?.projectId !== target ||
            bridge.view?.mode !== "read-only" || bridge.view?.writable !== false ||
            oldProjectId === target)
          throw Error("application-owned-selection-denied");
        globalThis.__applicationSecondFilmPhysicalCalls=(globalThis.__applicationSecondFilmPhysicalCalls||0)+1;
        recovered=bridge;`;
 candidate=candidate.slice(0,start)+choose+candidate.slice(end);
 const reopen='recovered=await controller.recover({token,selectionVaultId});';
 assert.equal(candidate.split(reopen).length,2,'application-owned reopen anchor drift');
 candidate=candidate.replace(reopen,'recovered=await applicationSecondFilm.reopen({token,selectionVaultId,projectId:target});');
 const edit='const result = await globalThis.__continuity.requestEditing({';
 assert.equal(candidate.split(edit).length,2,'application-owned admission anchor drift');
 candidate=candidate.replace(edit,'const result = await applicationSecondFilm.requestEditing({');
 const signature='const CreatorWorkspace = ({ creatorName = "Creator",';
 assert.equal(candidate.split(signature).length,2,'pinned component injection anchor drift');
 candidate=candidate.replace(signature,'const CreatorWorkspace = ({ applicationSecondFilm, creatorName = "Creator",');
 assert.equal(candidate.split('applicationSecondFilm.choose({').length,2);
 assert.equal(candidate.split('applicationSecondFilm.reopen({').length,2);
 assert.equal(candidate.split('applicationSecondFilm.requestEditing({').length,2);
 assert.equal(candidate.includes('__migratedSecondFilmCaller('),false);
 assert.equal(candidate.includes('recordPendingCreatorMessage'),false);
 return candidate;
}
