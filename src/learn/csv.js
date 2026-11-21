import { createHash } from 'node:crypto';
export const stableId = (kind, ...parts) => kind + ':' + createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 20);
export function parseCsv(text) {
  const out=[]; let row=[], field='', quote=false;
  const input=String(text).replace(/^\uFEFF/,'');
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(quote){if(c==='"' && input[i+1]==='"'){field+='"';i++}else if(c==='"') quote=false;else field+=c}
    else if(c==='"'){if(field==='') quote=true; else field+=c}
    else if(c===','){row.push(field);field=''}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&input[i+1]==='\n') i++;row.push(field);field='';if(row.some(v=>v!==''))out.push(row);row=[]}
    else field+=c;
  }
  if(quote) throw Error('Unterminated quoted CSV field');
  if(field!==''||row.length){row.push(field);out.push(row)}
  if(!out.length)return {columns:[],records:[]};
  const headers=out[0].map((v,i)=>v.trim()||'column_'+(i+1));
  if(new Set(headers).size!==headers.length)throw Error('Duplicate CSV column names');
  return {columns:headers,records:out.slice(1).map((cells,index)=>({
    rowNumber:index+2, values:Object.fromEntries(headers.map((h,i)=>[h,cells[i]??'']))
  }))};
}
export function inferType(values){
  const v=values.filter(x=>String(x).trim()!=='').map(x=>String(x).trim());
  if(!v.length)return 'empty';
  if(v.every(x=>/^[-+]?\d+(\.\d+)?$/.test(x)))return 'number';
  if(v.every(x=>/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}.*)?$/.test(x)))return 'date';
  return 'string';
}
export function csvToGraph(sourceName,csvText){
  const {columns,records}=parseCsv(csvText);
  const sourceId=stableId('source',sourceName);
  const source={id:sourceId,type:'source',name:sourceName,data:{format:'csv',rowCount:records.length},links:[]};
  const nodes=[source]; const types={};
  for(const col of columns){
    const values=records.map(r=>r.values[col]);types[col]=inferType(values);
    const id=stableId('column',sourceName,col);
    nodes.push({id,type:'column',name:col,data:{sourceId,dataType:types[col],examples:[...new Set(values.filter(Boolean))].slice(0,5)},links:[]});
    source.links.push({nodeId:id,relationship:'has column'});
  }
  for(const record of records){
    const id=stableId('row',sourceName,record.rowNumber);
    nodes.push({id,type:'row',name:sourceName+'#'+record.rowNumber,data:{sourceId,rowNumber:record.rowNumber,values:record.values},links:[]});
    source.links.push({nodeId:id,relationship:'has row'});
  }
  return nodes;
}
