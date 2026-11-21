import { stableId } from './csv.js';
const norm=x=>String(x??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const looksDate=s=> /^\d{4}-\d{2}-\d{2}/.test(String(s||''));
const toDay=s=> {const t=Date.parse(String(s));return Number.isFinite(t)?Math.floor(t/86400000):null};
function datesOf(row){
  return Object.entries(row.data.values).filter(([key,value])=>/date|time|when/i.test(key)||looksDate(value))
    .map(([,value])=>toDay(value)).filter(x=>x!==null);
}
function numericOf(row){
  return Object.entries(row.data.values).filter(([key,value])=> /amount|price|cost|total|debit|credit/i.test(key) && /^[-+]?\d+(\.\d+)?$/.test(String(value).trim()))
  .map(([field,value])=>({field,value:Number(value)}));
}
export function discoverPatterns(graph,{minRepeat=2,maxExamples=8}={}){
  const rows=graph.filter(n=>n.type==='row');
  const byValue=new Map();
  for(const row of rows){
    for(const [field,value] of Object.entries(row.data.values||{})){
      const key=norm(value);
      if(key.length<3||/^[-+]?\d+(\.\d+)?$/.test(key)||looksDate(key)||key.length>160)continue;
      const bucket=byValue.get(key)||[];
      bucket.push({rowId:row.id,sourceId:row.data.sourceId,field,value,day:datesOf(row)[0]??null});
      byValue.set(key,bucket);
    }
  }
  const patterns=[];
  for(const [value,refs] of byValue){
    const unique=[...new Map(refs.map(r=>[r.rowId,r])).values()];
    if(unique.length<minRepeat)continue;
    const sources=new Set(unique.map(r=>r.sourceId));
    const days=unique.map(r=>r.day).filter(n=>n!==null).sort((a,b)=>a-b);
    const gaps=days.slice(1).map((day,i)=>day-days[i]);
    const monthly=gaps.length>=2&&gaps.every(g=>g>=25&&g<=35);
    const weekly=gaps.length>=2&&gaps.every(g=>g>=6&&g<=8);
    const kind=sources.size>1?'cross_source_match':monthly?'monthly_repetition':weekly?'weekly_repetition':'repeated_value';
    const sameRows=rows.filter(r=>unique.some(u=>u.rowId===r.id));
    const amounts=sameRows.flatMap(numericOf);
    const id=stableId('pattern',kind,value,[...sources].sort());
    patterns.push({id,kind,value,count:unique.length,sourceCount:sources.size,
      interval:monthly?'monthly':weekly?'weekly':null,amounts:amounts.slice(0,maxExamples),
      evidence:unique.map(r=>r.rowId),examples:unique.slice(0,maxExamples)});
  }
  // Distinct values occurring in nearby records, across sources, are candidate temporal evidence.
  const bySource=new Map();
  for(const row of rows){const day=datesOf(row)[0];if(day===undefined)continue;
    const xs=bySource.get(day)||[];xs.push(row);bySource.set(day,xs)}
  // Bound expansion and avoid claiming temporal proximity means causation.
  let added=0;
  for(const [day,rs] of [...bySource].sort(([a],[b])=>a-b)){
    if(added>=50)break;
    const others=[...(bySource.get(day-1)||[]),...(bySource.get(day)||[]),...(bySource.get(day+1)||[])];
    for(const a of rs)for(const b of others){
      if(added>=50)break;
      if(a.id>=b.id||a.data.sourceId===b.data.sourceId)continue;
      patterns.push({id:stableId('pattern','temporal',a.id,b.id),kind:'temporal_proximity',value:'within 1 day',count:2,sourceCount:2,evidence:[a.id,b.id],examples:[]});added++;
    }
  }
  return patterns.sort((a,b)=>(b.sourceCount-a.sourceCount)||(b.count-a.count));
}
