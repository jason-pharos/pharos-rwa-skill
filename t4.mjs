// Hypothesis: if ALL balance reads fail, pALPHA is dropped entirely even
// though the Ember API has the position.
const {DEFAULT_REGISTRY}=await import('./src/config/registry.ts');
for(const e of DEFAULT_REGISTRY) for(const s of e.balanceSources){ s.rpcUrl='http://127.0.0.1:1'; s.rpcUrlFallbacks=[]; }
const {runPosition}=await import('./src/index.ts');
const r=await runPosition('0x68c8C1b8CA4C82b922675b25B8E1867b5C3d0fb6',{noRemote:true});
console.log('positions:',JSON.stringify(r.data.positions.map(p=>p.vault)));
console.log('errors:',JSON.stringify(r.errors,null,1));
