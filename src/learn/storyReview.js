import { activeLinks } from './claims.js';
/**
 * Targeted Learn review of affected micro-stories.
 * A retired story is retained with provenance but excluded from active discovery.
 * No row or entity is deleted because a story was judged incoherent.
 */
const arr=value=>Array.isArray(value)?value:[];
const clamp=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(1,Number(value))):0;
const clipped=(s,n=500)=>String(s??'').slice(0,n);
const isActive=node=>node?.type==='micro_story' && node?.data?.status!=='retired';
export function storyReviewCandidates(graph,{changedIds=[],changedPatternIds=[],forcePending=false}={}){
  const changed=new Set(changedIds),patterns=new Set(changedPatternIds);
  return graph.filter(isActive).filter(n=>
    (forcePending&&n.data?.reviewNeeded) ||
    changed.has(n.id) ||
    arr(n.data?.evidence).some(id=>patterns.has(id)) ||
    activeLinks(n).some(l=>changed.has(l.nodeId)||arr(l.evidence).some(id=>patterns.has(id))));
}
export function buildStoryReviewContext(graph,story,patterns){
  const byId=new Map(graph.map(n=>[n.id,n]));
  const ids=new Set([...arr(story.data?.evidence),...activeLinks(story).flatMap(l=>arr(l.evidence))]);
  const findings=patterns.filter(p=>ids.has(p.id)).slice(0,24).map(p=>({
    id:p.id,kind:p.kind,value:p.value,evidence:arr(p.evidence).slice(0,12)
  }));
  const rowIds=new Set(findings.flatMap(p=>p.evidence));
  const related=activeLinks(story).map(l=>({id:l.nodeId,relationship:l.relationship,
    name:byId.get(l.nodeId)?.name,type:byId.get(l.nodeId)?.type,
    description:byId.get(l.nodeId)?.data?.description,confidence:l.confidence})).slice(0,30);
  const rows=[...rowIds].map(id=>byId.get(id)).filter(n=>n?.type==='row')
    .slice(0,24).map(n=>({id:n.id,name:n.name,values:n.data?.values}));
  return {story:{id:story.id,name:story.name,description:story.data?.description,
    confidence:story.data?.confidence},related,findings,rows};
}
export const STORY_REVIEW_INSTRUCTIONS=`You are reviewing ONE existing LeMap micro-story during Learn, not answering a user query.
Decide whether its activities form a coherent story based on causal/functional connection, common purpose, meaningful sequence, or recurring activity.
Sharing only an actor, person, organization, location, topic or a nearby date is not sufficient; a person may have multiple unrelated stories.
A relationship between entities may suggest a connection, but does not alone prove that their activities belong to one story.
Keep unrelated activities separate unless observations demonstrate a meaningful functional, causal or purposive connection.
Return strict JSON {"decision":"keep|retire|uncertain","reason":"evidence-grounded brief reason","confidence":0.0}.
Retire only where the existing story is a catch-all grouping of unrelated activities with no supported plot continuity.
Prefer uncertain where evidence is insufficient either to support or refute coherence.
Do not invent new facts, IDs, observed actions, process completion, or connections. An indication of intent or preparation is not proof of completion.
The decision must concern the supplied story ID only.`;
export async function reviewStory(client,model,context){
  const result=await client.chat.completions.create({model,temperature:0,
    response_format:{type:'json_object'},messages:[
      {role:'system',content:STORY_REVIEW_INSTRUCTIONS},
      {role:'user',content:JSON.stringify(context)}]});
  const raw=JSON.parse(result.choices[0]?.message?.content||'{}');
  return {decision:['keep','retire','uncertain'].includes(raw.decision)?raw.decision:'uncertain',
    reason:clipped(raw.reason),confidence:clamp(raw.confidence)};
}
export function applyStoryReview(graph,storyId,verdict,revision){
  const node=graph.find(n=>n.id===storyId&&isActive(n));
  if(!node||!['keep','retire','uncertain'].includes(verdict?.decision))return false;
  // A model cannot retire a story without a substantive high-confidence judgment.
  const retire=verdict.decision==='retire'&&clamp(verdict.confidence)>=0.8&&clipped(verdict.reason).length>=20;
  const reviewed=verdict.decision==='keep'||retire;
  node.data={...node.data,
    status:retire?'retired':(node.data.status||'active'),
    reviewNeeded:!reviewed,
    reviewReason:reviewed?'':(verdict.reason||'Insufficient evidence for confident review'),
    lastReview:{revision,decision:retire?'retire':verdict.decision,confidence:clamp(verdict.confidence),reason:verdict.reason},
    reviewHistory:[...arr(node.data.reviewHistory),{revision,...verdict,appliedRetirement:retire}].slice(-20)};
  return retire;
}
export async function reviewAffectedStories(graph,patterns,{client,model,revision,changedIds=[],changedPatternIds=[],limit=6,forcePending=false}={}){
  if(!client)return {reviewed:0,retired:[],pending:storyReviewCandidates(graph,{changedIds,changedPatternIds,forcePending}).map(n=>n.id)};
  const candidates=storyReviewCandidates(graph,{changedIds,changedPatternIds,forcePending}).slice(0,limit);
  const retired=[];
  for(const story of candidates){
    const context=buildStoryReviewContext(graph,story,patterns);
    const verdict=await reviewStory(client,model,context);
    if(applyStoryReview(graph,story.id,verdict,revision))retired.push(story.id);
  }
  return {reviewed:candidates.length,retired,pending:graph.filter(n=>isActive(n)&&n.data?.reviewNeeded).map(n=>n.id)};
}
