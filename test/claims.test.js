import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareClaims,claimId,addOrSupportClaim,applyClaimReview,activeLinks,reconcileClaims} from '../src/learn/claims.js';
import {learnCsvFiles} from '../src/learn/engine.js';

const pA={id:'pattern:alpha',kind:'repeated_value',value:'component',evidence:['row:a']};
const pB={id:'pattern:beta',kind:'semantic_hint',value:'quality',evidence:['row:b']};
const pC={id:'pattern:gamma',kind:'semantic_hint',value:'expense',evidence:['row:c']};

test('generic claim retirement preserves observations and unrelated actor links',()=>{
 const story={id:'micro_story:assembly',type:'micro_story',name:'Assembly cycle',
   data:{description:'Recurring assembly cycle',evidence:[pA.id,pB.id,pC.id],searchTerms:['assembly','quality','expense']},
   links:[{nodeId:'event:production',relationship:'part of assembly',confidence:.9,evidence:[pA.id]},
     {nodeId:'event:expense',relationship:'unrelated spending',confidence:.7,evidence:[pC.id]}]};
 const graph=[story,{id:'event:production',type:'event',name:'Production',data:{},links:[]},
   {id:'event:expense',type:'event',name:'Expense',data:{},links:[]}];
 prepareClaims(graph);
 const original=story.links[1].claimId;
 const verdict={claims:[{claimId:original,decision:'retire',reason:'The expense belongs to an unrelated activity and cannot explain the production cycle.',confidence:.95,evidence:[pC.id]}],
   retireSearchTerms:['expense'],retireEvidence:[pC.id]};
 const out=applyClaimReview(story,verdict,[pA,pB,pC],{revision:7});
 assert.deepEqual(out.retired,[original]);
 assert.equal(activeLinks(story).length,1);
 assert.equal(story.links.length,2);
 assert.equal(story.links[1].status,'retired');
 assert.equal(story.data.claimReviewHistory[0].revision,7);
 assert.deepEqual(story.data.evidence,[pA.id,pB.id]);
 assert.deepEqual(story.data.searchTerms,['assembly','quality']);
 assert.ok(graph.find(n=>n.id==='event:expense'));
});
test('claim IDs are stable and equivalent new claims do not duplicate',()=>{
 const node={id:'entity:machine',type:'entity',data:{},links:[]};
 const claim={nodeId:'event:maintenance',relationship:'requires maintenance',evidence:[pA.id],confidence:.8};
 assert.equal(addOrSupportClaim(node,claim,{revision:1}),true);
 assert.equal(addOrSupportClaim(node,{...claim,evidence:[pA.id,pB.id]},{revision:2}),true);
 assert.equal(addOrSupportClaim(node,{...claim,evidence:[pB.id,pA.id]},{revision:3}),false);
 assert.equal(node.links.length,1);
 assert.equal(node.links[0].claimId,claimId(node.id,claim));
});
test('an uncertain or evidence-free retirement does not erase a claim',()=>{
 const node={id:'micro_story:other',type:'micro_story',data:{searchTerms:['alpha']},links:[{nodeId:'event:x',relationship:'related',evidence:[pA.id],confidence:.7}]};
 prepareClaims([node]);
 const verdict={claims:[{claimId:node.links[0].claimId,decision:'retire',confidence:.99,reason:'There is some unsupported uncertainty about whether the relationship exists',evidence:[]}],retireSearchTerms:['alpha']};
 const result=applyClaimReview(node,verdict,[pA],{revision:2});
 assert.equal(result.retired.length,0);
 assert.equal(activeLinks(node).length,1);
 assert.deepEqual(node.data.searchTerms,['alpha']);
});
test('generic incremental ingestion skips model calls on unchanged inputs after initial claim migration',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reasoner-claims-'));
 const mapPath=path.join(dir,'map.json');
 let requests=0;
 const client={chat:{completions:{create:async opts=>{
   requests++;
   const system=opts.messages[0].content;
   if(system.includes('semantic claim reconciler'))return {choices:[{message:{content:JSON.stringify({claims:[]})}}]};
   if(system.includes('reviewing ONE existing'))return {choices:[{message:{content:JSON.stringify({decision:'uncertain',reason:'Insufficient evidence',confidence:.5})}}]};
   return {choices:[{message:{content:JSON.stringify({annotations:[]})}}]};
 }}}};
 try{
   const files=[{name:'sensor.csv',content:'date,sensor,reading\n2026-01-01,boiler,40\n2026-01-02,boiler,41'}];
   const first=await learnCsvFiles({mapPath,files,client,model:'deepseek-chat'});
   const callsAfterFirst=requests;
   const second=await learnCsvFiles({mapPath,files,client,model:'deepseek-chat'});
   assert.equal(requests,callsAfterFirst);
   assert.equal(second.summary.claimReview.reviewed,0);
   assert.equal(second.state.claimSchemaVersion,1);
   assert.match(second.summary.llmSkipped,/No new observations/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('same generic reconciliation API works with any semantic entity or story',async()=>{
 const node={id:'entity:vendor',type:'entity',name:'Vendor',data:{evidence:[pA.id]},links:[
 {nodeId:'event:supply',relationship:'supplies',confidence:.8,evidence:[pA.id]}]};
 const graph=[node,{id:'event:supply',type:'event',name:'Delivery',data:{},links:[]}];
 let received;
 const client={chat:{completions:{create:async options=>{
   received=JSON.parse(options.messages[1].content);
   return {choices:[{message:{content:JSON.stringify({claims:[{claimId:received.claims[0].claimId,decision:'keep',reason:'The source observations support the current supplier claim.',confidence:.9,evidence:[pA.id]}]})}}]};
 }}}};
 const r=await reconcileClaims(graph,[pA],{client,model:'deepseek-chat',revision:2,migration:true});
 assert.equal(r.reviewed,1);
 assert.equal(r.retired.length,0);
 assert.equal(received.node.type,'entity');
});
