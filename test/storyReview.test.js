import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {learnCsvFiles} from '../src/learn/engine.js';
import {applyStoryReview,storyReviewCandidates,reviewAffectedStories,buildStoryReviewContext} from '../src/learn/storyReview.js';

const story={id:'micro_story:both',type:'micro_story',name:'Arun hospital and bus messages',
  data:{description:'Unrelated hospital follow-up and bus booking by same sender',confidence:0.65,
    evidence:['pattern:same'],reviewNeeded:true},links:[
      {nodeId:'entity:arun',relationship:'shared actor',evidence:['pattern:same']},
      {nodeId:'event:hospital',relationship:'hospital discussion',evidence:['pattern:same']},
      {nodeId:'event:bus',relationship:'bus booking discussion',evidence:['pattern:same']}
    ]};
const rows=[
 {id:'row:1',type:'row',name:'messages#2',data:{values:{date:'2026-02-01',sender:'Arun',text:'Follow-up at City Hospital tomorrow'}},links:[]},
 {id:'row:2',type:'row',name:'messages#3',data:{values:{date:'2026-01-07',sender:'Arun',text:'Booked a bus to Mysuru'}},links:[]}
];
const pattern={id:'pattern:same',kind:'repeated_value',value:'arun',evidence:['row:1','row:2']};
const keep={id:'micro_story:hospital',type:'micro_story',name:'Hospital follow-ups',data:{evidence:['pattern:same'],reviewNeeded:true},links:[]};

test('existing catch-all story is retired without deleting facts, actors or distinct stories',async()=>{
 const graph=[structuredClone(story),structuredClone(keep),...structuredClone(rows),
   {id:'entity:arun',type:'entity',name:'Arun',data:{},links:[]},
   {id:'event:hospital',type:'event',name:'Hospital follow-up',data:{},links:[]},
   {id:'event:bus',type:'event',name:'Bus booking',data:{},links:[]}];
 const calls=[];
 const client={chat:{completions:{create:async opts=>{
   calls.push(JSON.parse(opts.messages[1].content));
   const id=JSON.parse(opts.messages[1].content).story.id;
   const verdict=id==='micro_story:both'
     ? {decision:'retire',reason:'The hospital and bus activities have only the same sender, no connected purpose or event sequence.',confidence:0.96}
     : {decision:'keep',reason:'The hospital episodes share a coherent recurring purpose.',confidence:0.91};
   return {choices:[{message:{content:JSON.stringify(verdict)}}]};
 }}}};
 const review=await reviewAffectedStories(graph,[pattern],{client,model:'deepseek-chat',revision:4,forcePending:true});
 assert.deepEqual(review.retired,['micro_story:both']);
 assert.equal(graph.find(n=>n.id==='micro_story:both').data.status,'retired');
 assert.equal(graph.find(n=>n.id==='micro_story:hospital').data.status,'active');
 assert.ok(graph.find(n=>n.id==='entity:arun'));
 assert.ok(graph.find(n=>n.id==='event:hospital'));
 assert.ok(graph.find(n=>n.id==='event:bus'));
 assert.equal(calls.length,2);
 assert.deepEqual(calls[0].rows.map(r=>r.id),['row:1','row:2']);
 assert.equal(storyReviewCandidates(graph,{forcePending:true}).length,0);
});
test('cannot retire a story without sufficiently supported judgment',()=>{
 const graph=[structuredClone(story)];
 assert.equal(applyStoryReview(graph,'micro_story:both',{decision:'retire',reason:'uncertain',confidence:0.4},4),false);
 assert.notEqual(graph[0].data.status,'retired');
});
test('story review leaves structural map unchanged without a model',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reasoner-story-'));
 try{
  const mapPath=path.join(dir,'map.json');
  const csv='date,sender,text\n2026-01-01,Arun,Hospital follow-up\n2026-01-02,Arun,Booked bus';
  const result=await learnCsvFiles({mapPath,files:[{name:'messages.csv',content:csv}]});
  assert.equal(result.summary.storyReview.reviewed,0);
  assert.equal(result.summary.rows,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
