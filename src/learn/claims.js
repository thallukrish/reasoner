import { stableId } from './csv.js';

const arr=value=>Array.isArray(value)?value:[];
const clamp=x=>Math.max(0,Math.min(1,Number(x)||0));
const norm=s=>String(s??'').toLowerCase().trim().replace(/\s+/g,' ');
const bounded=(s,n=400)=>String(s??'').slice(0,n);
const active=link=>link.status!=='retired';
export function claimId(sourceId,link){
  const predicate=norm(link.relationKey||link.relationship||'related to');
  return stableId('claim',sourceId,link.nodeId,predicate);
}
export function prepareClaims(graph){
  for(const node of graph){
    if(!['entity','event','micro_story','workflow'].includes(node.type))continue;
    for(const link of arr(node.links)){
      if(!link.claimId)link.claimId=claimId(node.id,link);
      if(!link.status)link.status='active';
    }
  }
  return graph;
}
export function activeLinks(node){return arr(node.links).filter(active)}
export function addOrSupportClaim(node,edge,{revision=1}={}){
  const id=claimId(node.id,edge);
  const prior=arr(node.links).find(l=>l.claimId===id || (l.nodeId===edge.nodeId&&norm(l.relationship)===norm(edge.relationship)));
  const evidence=[...new Set(arr(edge.evidence))];
  if(!prior){
    node.links.push({...edge,claimId:id,status:'active',revision});
    return true;
  }
  const nextEvidence=[...new Set([...arr(prior.evidence),...evidence])];
  const score=clamp(edge.confidence);
  const before=JSON.stringify({e:prior.evidence,c:prior.confidence,status:prior.status});
  prior.evidence=nextEvidence;
  prior.confidence=score;
  prior.claimId=id;
  prior.status='active';
  if(before!==JSON.stringify({e:prior.evidence,c:prior.confidence,status:prior.status})){
    prior.revision=revision;
    return true;
  }
  return false;
}
export function claimReviewCandidates(graph,{changedIds=[],changedPatternIds=[],migration=false}={}){
  const changed=new Set(changedIds),patterns=new Set(changedPatternIds);
  return graph.filter(n=>['entity','event','micro_story','workflow'].includes(n.type)&&n.data?.status!=='retired')
    .filter(n=>migration || changed.has(n.id) ||
      arr(n.data?.evidence).some(id=>patterns.has(id)) ||
      activeLinks(n).some(l=>changed.has(l.nodeId)||arr(l.evidence).some(id=>patterns.has(id))));
}
export function buildClaimReviewContext(graph,node,patterns){
  const byId=new Map(graph.map(n=>[n.id,n]));
  const ids=new Set([...arr(node.data?.evidence),...activeLinks(node).flatMap(l=>arr(l.evidence))]);
  const findings=patterns.filter(p=>ids.has(p.id)).slice(0,45).map(p=>({
    id:p.id,kind:p.kind,value:p.value,rows:arr(p.evidence).slice(0,15)
  }));
  const rowIds=new Set(findings.flatMap(f=>f.rows));
  const rows=[...rowIds].slice(0,36).map(id=>byId.get(id)).filter(n=>n?.type==='row')
    .map(n=>({id:n.id,values:n.data?.values}));
  return {node:{id:node.id,type:node.type,name:node.name,description:node.data?.description},
    claims:activeLinks(node).map(l=>({claimId:l.claimId,target:l.nodeId,
      targetName:byId.get(l.nodeId)?.name,targetType:byId.get(l.nodeId)?.type,
      predicate:l.relationship,confidence:l.confidence,evidence:l.evidence})).slice(0,45),
    searchTerms:arr(node.data?.searchTerms).slice(0,35),
    evidence:arr(node.data?.evidence).slice(0,45),
    findings,rows};
}
export const CLAIM_REVIEW_INSTRUCTIONS=`You are a domain-independent LeMap Learn semantic claim reconciler, not a query agent.
You receive ONE semantic node, its existing relationship claims, search terms, pattern findings and bounded original observations.
Decide whether EACH existing relationship still expresses a supported claim about the node's CURRENT interpretation.
Multiple entities can be related without their activities forming one process. A shared actor or keyword alone cannot justify a story link.
For every claim you can assess, return its exact supplied claimId with decision "keep", "retire", or "uncertain", a short evidence-grounded reason, confidence, and supporting pattern IDs.
An old description/label or another inferred claim is not sufficient proof. Use provided observation/pattern evidence.
Retire only for a demonstrably incompatible, superseded or contradicted claim; omission, lack of context, or absence of evidence is "uncertain".
Review search terms separately: return exact terms to retire only when irrelevant to the CURRENT node interpretation, not merely because they lack recent hits.
Review evidence associations separately: retire a pattern ID from the node's ACTIVE interpretation only if the pattern concerns an unrelated or superseded interpretation. Preserve the underlying pattern and observation.
JSON: {"claims":[{"claimId":"exact ID","decision":"keep|retire|uncertain","confidence":0.0,"reason":"why","evidence":["existing pattern ID"]}],"retireSearchTerms":["exact term"],"retireEvidence":["existing pattern ID"]}.
Don't invent source records, IDs, or contradictions. If evidence is insufficient, leave uncertain. Keep the response bounded.`;
export async function interpretClaimReview(client,model,context){
  const r=await client.chat.completions.create({model,temperature:0,response_format:{type:'json_object'},
    messages:[{role:'system',content:CLAIM_REVIEW_INSTRUCTIONS},{role:'user',content:JSON.stringify(context)}]});
  return JSON.parse(r.choices[0]?.message?.content||'{}');
}
export function applyClaimReview(node,verdict,patterns,{revision=1}={}){
  const knownPatterns=new Set(patterns.map(p=>p.id));
  const byId=new Map(activeLinks(node).map(l=>[l.claimId,l]));
  const retired=[];const upheld=[];const uncertain=[];
  const seen=new Set();
  for(const r of arr(verdict?.claims)){
    const link=byId.get(r.claimId);
    if(!link||seen.has(r.claimId))continue;
    seen.add(r.claimId);
    const cited=arr(r.evidence).filter(id=>knownPatterns.has(id)&&arr(link.evidence).includes(id));
    const decision=['keep','retire','uncertain'].includes(r.decision)?r.decision:'uncertain';
    const sufficient=clamp(r.confidence)>=0.8&&bounded(r.reason).length>=20&&cited.length>0;
    if(decision==='retire'&&sufficient){
      link.status='retired';link.retiredRevision=revision;link.retirement={reason:bounded(r.reason),confidence:clamp(r.confidence),evidence:cited};
      retired.push(link.claimId);
    }else if(decision==='keep'&&sufficient){upheld.push(link.claimId)}
    else uncertain.push(link.claimId);
  }
  for(const id of byId.keys())if(!seen.has(id))uncertain.push(id);
  // Scope modifications to exact terms/IDs supplied to the reviewer.
  const reportedTerms=new Set(arr(verdict?.retireSearchTerms));
  const reportedEvidence=new Set(arr(verdict?.retireEvidence));
  const currentTerms=arr(node.data?.searchTerms);
  const currentEvidence=arr(node.data?.evidence);
  // Term/evidence retirement is allowed only alongside a well-supported retired claim.
  const retirementSupported=retired.length>0;
  const removedTerms=retirementSupported?currentTerms.filter(t=>reportedTerms.has(t)):[];
  const removedEvidence=retirementSupported?currentEvidence.filter(id=>reportedEvidence.has(id)&&knownPatterns.has(id)):[];
  if(removedTerms.length||removedEvidence.length){
    node.data={...node.data,
      searchTerms:currentTerms.filter(t=>!removedTerms.includes(t)),
      evidence:currentEvidence.filter(id=>!removedEvidence.includes(id)),
      inactiveHints:[...new Set([...arr(node.data?.inactiveHints),...removedTerms])],
      inactiveEvidence:[...new Set([...arr(node.data?.inactiveEvidence),...removedEvidence])]};
  }
  if(retired.length||removedTerms.length||removedEvidence.length){
    node.data={...node.data,
      claimReviewHistory:[...arr(node.data?.claimReviewHistory),{revision,retired,removedTerms,removedEvidence}].slice(-20)};
  }
  return {retired,upheld,uncertain,removedTerms,removedEvidence};
}
export async function reconcileClaims(graph,patterns,{client,model,revision=1,changedIds=[],changedPatternIds=[],migration=false,limit=15}={}){
  prepareClaims(graph);
  if(!client)return {reviewed:0,retired:[],pending:[]};
  const nodes=claimReviewCandidates(graph,{changedIds,changedPatternIds,migration}).filter(n=>activeLinks(n).length)
    .slice(0,limit);
  const retired=[];const pending=[];
  for(const node of nodes){
    const ctx=buildClaimReviewContext(graph,node,patterns);
    const verdict=await interpretClaimReview(client,model,ctx);
    const result=applyClaimReview(node,verdict,patterns,{revision});
    retired.push(...result.retired.map(id=>({nodeId:node.id,claimId:id})));
    if(result.uncertain.length)pending.push({nodeId:node.id,claims:result.uncertain});
  }
  return {reviewed:nodes.length,retired,pending};
}
