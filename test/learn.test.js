import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {parseCsv,csvToGraph} from '../src/learn/csv.js';
import {discoverPatterns} from '../src/learn/patterns.js';
import {learnCsvFiles,lemapCompatibleRoundtrip} from '../src/learn/engine.js';

const bank=['date,description,amount','2026-01-02,City Hospital,-1500','2026-02-02,City Hospital,-1200','2026-03-02,City Hospital,-1500'].join('\n');
const emails=['date,sender,subject','2026-01-01,City Hospital,Appointment','2026-02-01,City Hospital,Follow up'].join('\n');
test('CSV parser handles quoted commas, newlines and BOM',()=>{
 const x=parseCsv('\uFEFFname,text\nA,"Hello, world"\nB,"line 1\nline 2"\n');
 assert.equal(x.records.length,2);assert.equal(x.records[0].values.text,'Hello, world');
 assert.equal(x.records[1].values.text,'line 1\nline 2');
});
test('structural graph has stable parent, column, row ids',()=>{
 const first=csvToGraph('bank.csv',bank),second=csvToGraph('bank.csv',bank);
 assert.deepEqual(first,second);
 assert.equal(first.filter(n=>n.type==='row').length,3);
 assert.equal(first[0].links.filter(l=>l.relationship==='has column').length,3);
});
test('detectors find recurrence and cross-source values without a model',()=>{
 const patterns=discoverPatterns([...csvToGraph('bank.csv',bank),...csvToGraph('emails.csv',emails)]);
 assert.ok(patterns.some(p=>p.kind==='cross_source_match'&&p.value==='city hospital'));
 assert.ok(patterns.some(p=>p.evidence.length>=2));
});
test('incremental Learn merges structures, adds micro-story and preserves evidence',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reasoner-'));
 const mapPath=path.join(dir,'map.json');
 try{
   const first=await learnCsvFiles({mapPath,files:[{name:'bank.csv',content:bank}]});
   assert.equal(first.summary.rows,3);
   const second=await learnCsvFiles({mapPath,files:[{name:'emails.csv',content:emails}],annotations:[
     {key:'city-hospital',type:'entity',name:'City Hospital',description:'Likely healthcare provider',confidence:0.9,
      searchTerms:['doctor','appointment'],evidence:[],related:[]}
   ]});
   // Empty evidence must not create an ungrounded semantic node.
   assert.equal(second.summary.semanticNodes,0);
   const p=second.state.patterns.find(p=>p.value==='city hospital');
   assert.ok(p);
   const third=await learnCsvFiles({mapPath,files:[],annotations:[
     {key:'city-hospital',type:'entity',name:'City Hospital',description:'Healthcare provider',confidence:0.91,
      searchTerms:['hospital'],evidence:[p.id],related:[{key:'medical-episode',relationship:'participates in',confidence:0.8,evidence:[p.id]}]},
     {key:'medical-episode',type:'micro_story',name:'Recurring medical activity',description:'Repeated records involving a hospital',
      confidence:0.7,evidence:[p.id],searchTerms:['follow-up'],related:[]}
   ]});
   assert.equal(third.summary.semanticNodes,2);
   const graph=lemapCompatibleRoundtrip(third.state.graph);
   assert.ok(graph.some(n=>n.type==='micro_story'));
   assert.ok(graph.some(n=>n.type==='entity'&&n.links.some(l=>l.relationship==='participates in')));
   assert.ok(fs.existsSync(mapPath));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
