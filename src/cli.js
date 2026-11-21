import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { learnCsvFiles } from './learn/engine.js';
const files=process.argv.slice(2).filter(v=>v.endsWith('.csv'));
if(!files.length){console.error('Usage: npm run demo -- path/to/bank.csv [path/to/emails.csv ...]');process.exit(1)}
const source=files.map(file=>({name:path.basename(file),content:fs.readFileSync(file,'utf8')}));
const usingDeepSeek=!!process.env.DEEPSEEK_API_KEY;
const client=usingDeepSeek
  ? new OpenAI({apiKey:process.env.DEEPSEEK_API_KEY,baseURL:process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com'})
  : process.env.OPENAI_API_KEY ? new OpenAI({apiKey:process.env.OPENAI_API_KEY}) : null;
const mapPath=process.env.REASONER_MAP||'data/learn-map.json';
const result=await learnCsvFiles({files:source,mapPath,client,model:usingDeepSeek ? (process.env.DEEPSEEK_MODEL||'deepseek-chat') : (process.env.OPENAI_MODEL||'gpt-4.1-mini')});
console.log(JSON.stringify(result.summary,null,2));
console.log('Map written to '+mapPath);
