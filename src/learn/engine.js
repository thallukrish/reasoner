import fs from 'node:fs';
import path from 'node:path';
import { csvToGraph,stableId } from './csv.js';
import { discoverPatterns } from './patterns.js';
import { discoverHintPatterns } from './hints.js';
import { reviewAffectedStories } from './storyReview.js';
import { buildSemanticRequest,interpretPatterns,applyAnnotations } from './semantic.js';
import { graphFromSemanticObjects,semanticObjectsFromGraph } from '../graph/lemapGraph.js';
export function readMap(file){
  if(!fs.existsSync(file))return {version:1,revision:0,graph:[],patterns:[],history:[]};
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Array.isArray(saved.graph))throw Error('Invalid map graph');
  return saved;
}
export function writeMap(file,state){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2));
  JSON.parse(fs.readFileSync(temp,'utf8'));fs.renameSync(temp,file);
}
export function mergeStructural(existing,newNodes){
  const byId=new Map(existing.map(n=>[n.id,n]));
  const inserted=[];
  for(const n of newNodes){
    const prev=byId.get(n.id);
    if(!prev){byId.set(n.id,n);inserted.push(n.id)}
    else if(['source','column','row'].includes(n.type)){
      // Replace source snapshots; changed values are never silently overwritten.
      if(JSON.stringify(prev.data)!==JSON.stringify(n.data)) {byId.set(n.id,n);inserted.push(n.id)}
    }
  }
  return {graph:[...byId.values()],changed:inserted};
}
function patternNodes(patterns){
  return patterns.map(p=>({id:p.id,type:'pattern',name:p.kind+': '+p.value,
    data:{kind:p.kind,description:p.value,count:p.count,interval:p.interval,evidence:p.evidence,examples:p.examples},
    links:p.evidence.map(id=>({nodeId:id,relationship:'observed in',confidence:1,evidence:[id]}))}));
}
export async function learnCsvFiles({files,mapPath,client=null,model='gpt-4.1-mini',annotations=null}){
  const state=readMap(mapPath);
  let graph=state.graph;const structuralChanges=[];
  for(const file of files){
    const merged=mergeStructural(graph,csvToGraph(file.name,file.content));
    graph=merged.graph;structuralChanges.push(...merged.changed);
  }
  // Refresh deterministic findings from current structural evidence. Semantic nodes are preserved.
  const knownTerms=graph.filter(n=>['entity','event','micro_story'].includes(n.type))
    .flatMap(n=>n.data?.searchTerms||[]);
  let patterns=[...discoverPatterns(graph),...discoverHintPatterns(graph,knownTerms)];
  const currentPatternIds=new Set(patterns.map(p=>p.id));
  const oldPatterns=new Map((state.patterns||[]).map(p=>[p.id,p]));
  const impacted=patterns.filter(p=>JSON.stringify(oldPatterns.get(p.id))!==JSON.stringify(p)).map(p=>p.id);
  const base=graph.filter(n=>n.type!=='pattern');
  graph=mergeStructural(base,patternNodes(patterns)).graph;
  const payload=buildSemanticRequest(graph,patterns);
  const result=annotations===null?await interpretPatterns(payload,{client,model}):{annotations};
  let update=applyAnnotations(graph,patterns,result.annotations,{revision:state.revision+1});
  // A single bounded feedback pass: newly inferred semantic search terms
  // are searched locally, and only fresh evidence summaries go to the LLM.
  const initialIds=new Set(patterns.map(p=>p.id));
  const suggestedTerms=update.graph.filter(n=>['entity','event','micro_story'].includes(n.type))
    .flatMap(n=>n.data?.searchTerms||[]);
  const fresh=discoverHintPatterns(update.graph,suggestedTerms).filter(p=>!initialIds.has(p.id));
  if(fresh.length){
    impacted.push(...fresh.map(p=>p.id));
    patterns=[...patterns,...fresh];
    update.graph=mergeStructural(update.graph,patternNodes(fresh)).graph;
    if(client && annotations===null){
      const feedback=await interpretPatterns(buildSemanticRequest(update.graph,fresh),{client,model});
      const revised=applyAnnotations(update.graph,patterns,feedback.annotations,{revision:state.revision+1});
      update={graph:revised.graph,changed:[...new Set([...update.changed,...revised.changed])]};
    }
  }
  // Revisit only semantically affected neighbors, and mark their revision dependencies.
  const affected=new Set(update.changed);
  for(const n of update.graph.filter(n=>['micro_story','workflow'].includes(n.type))){
    if(n.links.some(l=>affected.has(l.nodeId)||l.evidence?.some(id=>impacted.includes(id)))){
      n.data={...n.data,reviewNeeded:true,reviewReason:'connected evidence or entity changed'};
      affected.add(n.id);
    }
  }
  const review=await reviewAffectedStories(update.graph,patterns,{client,model,revision:state.revision+1,changedIds:update.changed,changedPatternIds:impacted,forcePending:true});
  const next={version:1,revision:state.revision+1,graph:update.graph,patterns,
    history:[...(state.history||[]),{revision:state.revision+1,sourceFiles:files.map(f=>f.name),
      structuralChanges:structuralChanges.length,changedPatternIds:impacted,semanticChanges:[...affected],
      storyReview:{reviewed:review.reviewed,retired:review.retired,pending:review.pending},
      llmSkipped:result.skipped||null}].slice(-100)};
  writeMap(mapPath,next);
  return {state:next,summary:{revision:next.revision,sources:next.graph.filter(n=>n.type==='source').length,
    rows:next.graph.filter(n=>n.type==='row').length,patterns:patterns.length,
    semanticNodes:next.graph.filter(n=>['entity','event','micro_story'].includes(n.type)).length,
    affected:[...affected],storyReview:{reviewed:review.reviewed,retired:review.retired,pending:review.pending},llmSkipped:result.skipped||null}};
}
export function lemapCompatibleRoundtrip(graph){
  return graphFromSemanticObjects(semanticObjectsFromGraph(graph));
}
