import { stableId } from './csv.js';
const normalized=s=>String(s??'').toLowerCase().normalize('NFKC').replace(/\s+/g,' ').trim();
/**
 * A bounded deterministic local search over structured observations, driven by
 * semantic search terms suggested during Learn. This is not query traversal.
 */
export function discoverHintPatterns(graph,terms,{maxTerms=30,maxMatchesPerTerm=12}={}){
  const rows=graph.filter(n=>n.type==='row');
  const patterns=[];
  const unique=[...new Set(terms.map(normalized).filter(t=>t.length>=4&&t.length<=80))].slice(0,maxTerms);
  for(const term of unique){
    const hits=[];
    for(const row of rows){
      const fields=Object.entries(row.data.values||{}).filter(([,v])=>normalized(v).includes(term)).map(([f])=>f);
      if(fields.length)hits.push({rowId:row.id,sourceId:row.data.sourceId,fields});
      if(hits.length>=maxMatchesPerTerm)break;
    }
    if(!hits.length)continue;
    patterns.push({id:stableId('pattern','semantic_hint',term),kind:'semantic_hint',value:term,count:hits.length,
      sourceCount:new Set(hits.map(h=>h.sourceId)).size,evidence:hits.map(h=>h.rowId),examples:hits});
  }
  return patterns;
}
