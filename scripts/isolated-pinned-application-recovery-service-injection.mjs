// Source-exact recovery service injection for the disposable pinned React
// candidate. Harness globals may supply props outside the component, but
// native recovery/edit controls must consume explicit injected dependencies.
import assert from 'node:assert/strict';
export function transformPinnedApplicationOwnedRecoveryServices(source){
 const signature='const CreatorWorkspace = ({ applicationSecondFilm, studioServices, creatorName = "Creator",';
 assert.equal(source.split(signature).length,2,'pinned application service signature drift');
 const start='const requestVerifiedServerFilm = async () => {';
 const end='const activeCreator = useMemo(';
 assert.equal(source.split(start).length,2,'pinned recovery handler start drift');
 assert.equal(source.split(end).length,2,'pinned recovery handler end drift');
 const i=source.indexOf(start),j=source.indexOf(end,i);
 assert.ok(j>i,'pinned recovery handler order drift');
 let handlers=source.slice(i,j);
 const substitutions=[
  ['globalThis.__continuity','studioRecoveryServices?.continuity'],
  ['globalThis.__diagnosticToken','studioRecoveryServices?.token'],
  ['const selectionVaultId = "physical-studio-selection-vault";',
   'const selectionVaultId = studioRecoveryServices?.selectionVaultId;'],
  ['selectionVaultId:"physical-studio-selection-vault",operationId:"adopt-film-b"',
   'selectionVaultId:studioRecoveryServices?.selectionVaultId,operationId:"adopt-film-b"']
 ];
 for(const [oldText,newText] of substitutions){
  assert.ok(handlers.includes(oldText),'pinned recovery service anchor drift: '+oldText);
  handlers=handlers.replaceAll(oldText,newText);
 }
 assert.doesNotMatch(handlers,/globalThis\.__continuity|globalThis\.__diagnosticToken/);
 assert.match(handlers,/studioRecoveryServices\?\.continuity/);
 assert.match(handlers,/studioRecoveryServices\?\.selectionVaultId/);
 assert.match(handlers,/studioRecoveryServices\?\.token/);
 const modified=source.slice(0,i)+handlers+source.slice(j);
 const final=modified.replace(signature,
  'const CreatorWorkspace = ({ applicationSecondFilm, studioServices, studioRecoveryServices, creatorName = "Creator",');
 assert.equal(final.split('studioRecoveryServices, creatorName = "Creator"').length,2);
 return final;
}
