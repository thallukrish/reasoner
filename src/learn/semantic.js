import { stableId } from './csv.js';
const allowedTypes=new Set(['entity','micro_story','event']);
const bounded=(value,max=500)=>String(value??'').slice(0,max);
const arr=value=>Array.isArray(value)?value:[];
function normalizeId(value){return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)}
export function buildSemanticRequest(graph,patterns,{maxPatterns=30}={}){
  const sources=graph.filter(n=>n.type==='source').map(n=>({id:n.id,name:n.name,rowCount:n.data.rowCount}));
  const columns=graph.filter(n=>n.type==='column').map(n=>({sourceId:n.data.sourceId,name:n.name,type:n.data.dataType,examples:n.data.examples}));
  const findings=patterns.slice(0,maxPatterns).map(p=>({id:p.id,kind:p.kind,value:p.value,count:p.count,interval:p.interval,
    sourceCount:p.sourceCount,examples:p.examples.slice(0,4),evidence:p.evidence.slice(0,8)}));
  const known=graph.filter(n=>['entity','micro_story','event'].includes(n.type)).map(n=>({id:n.id,type:n.type,name:n.name,
    description:n.data?.description,confidence:n.data?.confidence,searchTerms:n.data?.searchTerms||[] })).slice(0,100);
  return {sources,columns,findings,known};
}
const INSTRUCTIONS=`You are the LeMap Learn semantic interpreter, NOT a query-answering agent.
Input contains structural CSV metadata, compact deterministic patterns, and existing semantic nodes.
Discover candidate semantic entities, events and micro-stories supported by pattern evidence.
Return strict JSON: {"annotations":[{"key":"stable semantic key","type":"entity|event|micro_story","name":"name","description":"short evidence-grounded description","confidence":0.0,"searchTerms":["term"],"evidence":["pattern id"],"related":[{"key":"other annotation key or existing node id","relationship":"meaningful relationship","confidence":0.0,"evidence":["pattern id"]}]}]}.
Use ONLY evidence IDs that occur in the provided findings; do not fabricate records or claim actual travel/visits based only on a booking/payment.
You may update a known semantic node by using its exact id as key. Do not duplicate existing entities.
Avoid weak stories based solely on one coincidental date match. Confidence means strength of available evidence, not probability of truth.
Do not answer personal health or finance questions; only annotate the map. Limit output to 15 annotations.`;
export async function interpretPatterns(payload,{client,model='gpt-4.1-mini'}={}){
  if(!client)return {annotations:[],skipped:'LLM unavailable; structural and pattern learning still works'};
  const response=await client.chat.completions.create({model,temperature:0,messages:[
    {role:'system',content:INSTRUCTIONS},{role:'user',content:JSON.stringify(payload)}],
    response_format:{type:'json_object'}});
  const parsed=JSON.parse(response.choices[0]?.message?.content||'{}');
  return {annotations:arr(parsed.annotations).slice(0,15)};
}
export function applyAnnotations(graph,patterns,annotations,{revision=1}={}){
  const byId=new Map(graph.map(n=>[n.id,n]));const patternById=new Map(patterns.map(p=>[p.id,p]));
  const changed=new Set();const resolved=new Map();const accepted=[];
  for(const raw of arr(annotations)){
    if(!allowedTypes.has(raw.type)||!raw.name||!raw.key)continue;
    const evidence=[...new Set(arr(raw.evidence).filter(id=>patternById.has(id)))];
    if(!evidence.length)continue;
    const existing=byId.get(raw.key);
    if(existing && !allowedTypes.has(existing.type))continue;
    const nodeId=existing?.id||stableId(raw.type,normalizeId(raw.key));
    const node=existing||{id:nodeId,type:raw.type,name:bounded(raw.name,160),data:{},links:[]};
    if(existing && existing.type!==raw.type)continue;
    const nextEvidence=[...new Set([...(node.data.evidence||[]),...evidence])];
    const old={description:node.data.description,confidence:node.data.confidence,evidence:node.data.evidence||[]};
    node.name=bounded(raw.name,160);
    node.data={...node.data,description:bounded(raw.description),confidence:Math.max(0,Math.min(1,Number(raw.confidence)||0)),
      evidence:nextEvidence,searchTerms:[...new Set([...(node.data.searchTerms||[]),...arr(raw.searchTerms).map(s=>bounded(s,80))])].slice(0,30),
      revision,previous:old.description!==undefined?[...arr(node.data.previous),{revision:revision-1,...old}].slice(-10):[]};
    byId.set(nodeId,node);resolved.set(raw.key,nodeId);accepted.push({raw,node});
    changed.add(nodeId);
  }
  for(const {raw,node} of accepted){
    for(const edge of arr(raw.related)){
      const target=resolved.get(edge.key)|| (byId.has(edge.key)?edge.key:null);
      if(!target||target===node.id)continue;
      const evidence=[...new Set(arr(edge.evidence).filter(id=>patternById.has(id)))];
      if(!evidence.length)continue;
      const relation=bounded(edge.relationship||'related to',80);
      const prior=node.links.find(l=>l.nodeId===target&&l.relationship===relation);
      if(prior){prior.evidence=[...new Set([...(prior.evidence||[]),...evidence])];prior.confidence=Math.max(0,Math.min(1,Number(edge.confidence)||0))}
      else node.links.push({nodeId:target,relationship:relation,confidence:Math.max(0,Math.min(1,Number(edge.confidence)||0)),evidence});
      changed.add(node.id);
    }
  }
  return {graph:[...byId.values()],changed:[...changed]};
}
