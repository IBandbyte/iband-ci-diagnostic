// Isolated Express composition candidate, not mounted in production.
import express from 'express';
export function createStudioVaultExpressRouter({authority,authenticateOwner,beforeReply=async()=>{}}={}){
 if(typeof authority?.create!=='function'||typeof authority?.resolve!=='function'||typeof authenticateOwner!=='function'||typeof beforeReply!=='function')throw Error('vault-router-dependencies-required');
 const router=express.Router();
 for(const [path,method] of [['/selection-vault-create','create'],['/selection-vault','resolve']]){
  router.post(path,async(req,res)=>{
   res.set('Cache-Control','no-store');
   const match=/^Bearer ([^\s]+)$/.exec(req.get('authorization')||'');
   let owner;
   try{owner=match&&await authenticateOwner(match[1]);}catch{}
   if(typeof owner!=='string'||!owner)return res.status(401).json({ok:false});
   if(!req.body||Array.isArray(req.body)||typeof req.body!=='object'||Object.keys(req.body).length)return res.status(400).json({ok:false});
   try{
    const result=await authority[method]({token:match[1]});
    if(result?.ok!==true)return res.status(403).json({ok:false});
    if(typeof result.vaultId!=='string'||!result.vaultId)throw Error('invalid-vault-proof');
    await beforeReply({method,owner,result});
    return res.status(method==='create'&&!result.replayed?201:200).json(result);
   }catch{return res.status(503).json({ok:false});}
  });
 }
 return router;
}
