import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { learnCsvFiles } from './learn/engine.js';
const files=process.argv.slice(2).filter(v=>v.endsWith('.csv'));
if(!files.length){console.error('Usage: npm run demo -- path/to/bank.csv [path/to/emails.csv ...]');process.exit(1)}
const source=files.map(file=>({name:path.basename(file),content:fs.readFileSync(file,'utf8')}));
const client=process.env.OPENAI_API_KEY?new OpenAI({apiKey:process.env.OPENAI_API_KEY}):null;
const mapPath=process.env.REASONER_MAP||'data/learn-map.json';
const result=await learnCsvFiles({files:source,mapPath,client,model:process.env.OPENAI_MODEL||'gpt-4.1-mini'});
console.log(JSON.stringify(result.summary,null,2));
console.log('Map written to '+mapPath);
