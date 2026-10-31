import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** SQL lexical inspection only: NOT a PostgreSQL or PL/pgSQL parser. */
export function tokenizeSql(sql){
  const tokens=[];let i=0;
  while(i<sql.length){
    if(/\s/.test(sql[i])){i++;continue;}
    if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i+2);i=end<0?sql.length:end+1;continue;}
    if(sql.startsWith('/*',i)){
      let level=1;i+=2;while(i<sql.length&&level){if(sql.startsWith('/*',i)){level++;i+=2;}else if(sql.startsWith('*/',i)){level--;i+=2;}else i++;}
      if(level)throw new Error('Unterminated SQL comment');continue;
    }
    const start=i;
    if(sql[i]==="'"||sql[i]==='"'){
      const quote=sql[i++];let value='';let closed=false;
      while(i<sql.length){if(sql[i]===quote){if(sql[i+1]===quote){value+=quote;i+=2;}else{i++;closed=true;break;}}else value+=sql[i++];}
      if(!closed)throw new Error('Unterminated SQL quoted token');
      tokens.push({kind:quote==="'"?'string':'identifier',value,start});continue;
    }
    const tag=sql.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/)?.[0];
    if(tag){i+=tag.length;const end=sql.indexOf(tag,i);if(end<0)throw new Error('Unterminated SQL dollar block');tokens.push({kind:'dollar',tag,value:sql.slice(i,end),start});i=end+tag.length;continue;}
    const word=sql.slice(i).match(/^[a-zA-Z_][a-zA-Z_0-9]*/)?.[0];
    if(word){tokens.push({kind:'word',value:word.toLowerCase(),start});i+=word.length;continue;}
    tokens.push({kind:'symbol',value:sql[i++],start});
  }
  return tokens;
}
export function splitStatements(sql){
  const tokens=tokenizeSql(sql);const statements=[];let current=[];
  for(const t of tokens){if(t.kind==='symbol'&&t.value===';'){if(current.length)statements.push(current);current=[];}else current.push(t);}
  if(current.length)throw new Error('SQL statement missing terminating semicolon');return statements;
}
const objectName=(tokens,start)=>tokens.slice(start,start+3).map(t=>t.value).join('');
const render=tokens=>tokens.map(t=>t.kind==='dollar'?t.value:t.kind==='string'?`'${t.value}'`:t.value).join(' ');
export function inspectMigration(sql){
  const statements=splitStatements(sql);const issues=[];const tables=[];const functions=[];
  const bodySql=statements.flatMap(s=>s.filter(t=>t.kind==='dollar').map(t=>t.value)).join('\n');
  const allSql=statements.map(render).join('\n').replace(/\s*\.\s*/g,'.');
  const keywords=statements.flatMap(s=>s.flatMap(t=>t.kind==='dollar'?tokenizeSql(t.value):[t]))
    .filter(t=>t.kind!=='string').map(t=>t.value).join(' ');
  const bodies=bodySql.replace(/--[^\n]*/g,'');
  const check=(condition,message)=>{if(!condition)issues.push(message);};
  check(render(statements[0])==='begin','Transaction must begin before all DDL');
  check(render(statements.at(-1))==='commit','Migration must commit only at end');
  check(!/\bcreate\s+or\s+replace\b/i.test(allSql),'Existing objects must not be replaced');
  check(!/\bdrop\b|\btruncate\b|\bcascade\b/i.test(keywords),'Migration must not delete objects or use cascade');
  check(!/\balter\s+role\b|\balter\s+default\s+privileges\b/i.test(allSql),'Shared/default role settings must not be changed');
  check(!/\bgrant\s+eye_stock_executor\s+to\b/i.test(allSql),'No role membership grants');
  check(!/\b(?:raise\s+sqlstate|errcode\s*=)\s*'(?:40001|40P01)'/i.test(bodies),'No retryable SQLSTATE for business errors');
  check(!/\b(?:while|pg_sleep|pg_terminate_backend|pg_cancel_backend|pg_stat_statements_reset)\b/i.test(bodies),'No unbounded loop or operational mutation');
  check(!/\b(?:update|insert\s+into|delete\s+from|alter\s+table|truncate)\s+(?:auth\.|lens_stock\.|public\.itsuka_)/i.test(allSql),'No mutations of other applications/auth');
  check(!/\bgrant\s+.*\bon\s+(?:schema\s+)?auth\b/i.test(allSql),'No grants on shared auth objects');
  for(const match of allSql.matchAll(/\b(?:update|insert\s+into|delete\s+from|alter\s+table)\s+([a-z_][a-z_0-9]*)\.([a-z_][a-z_0-9]*)/gi))
    check(match[1]==='eye_stock',`Mutation outside dedicated schema: ${match[1]}.${match[2]}`);
  for(const s of statements){
    const words=s.map(t=>t.value);
    if(words[0]==='create'&&words[1]==='table'){
      const name=objectName(s,2);tables.push(name);check(name.startsWith('eye_stock.'),`Unexpected table ${name}`);
    }
    if(words[0]==='alter'&&words[1]==='table')check(objectName(s,2).startsWith('eye_stock.'),'ALTER TABLE outside dedicated schema');
    if(words[0]==='alter'&&words[1]==='function')check(objectName(s,2).startsWith('eye_stock.'),'ALTER FUNCTION outside dedicated schema');
    if(words[0]==='grant'||words[0]==='revoke'){
      for(let i=0;i<s.length-2;i++)if(s[i+1].value==='.'&&(s[i].kind==='word'||s[i].kind==='identifier')){
        const name=objectName(s,i);check(name.startsWith('eye_stock.')||name.startsWith('public.eye_stock_'),`Privilege target outside Eye Drops: ${name}`);
      }
      const index=words.indexOf('schema');if(index>=0)check(words[index+1]==='eye_stock','Privileges on shared schema');
    }
    if(words[0]==='create'&&words[1]==='function'){
      const name=objectName(s,2);const text=render(s);functions.push(name);
      check(name.startsWith('eye_stock.')||name.startsWith('public.eye_stock_'),`Unexpected function ${name}`);
      check(/set search_path = ''/i.test(text),`Mutable search_path: ${name}`);
      if(name.startsWith('public.'))check(/security invoker/i.test(text),`Public SECURITY DEFINER: ${name}`);
    }
    if(words[0]==='create'&&words[1]==='role')check(words[2]==='eye_stock_executor'&&!words.includes('login')&&!words.includes('bypassrls'),'Unsafe role');
  }
  const rls=statements.flatMap(s=>s.filter(t=>t.kind==='dollar'&&t.tag==='$rls$'))[0]?.value??'';
  for(const table of tables)check(rls.includes(`'${table.split('.')[1]}'`),`Table missing in RLS/REVOKE loop: ${table}`);
  check(/enable row level security/i.test(rls)&&/force row level security/i.test(rls),'RLS must be enabled and forced');
  check(/with check.*user_id/i.test(rls),'RLS must include ownership WITH CHECK');
  check(/revoke all on table eye_stock/i.test(rls),'Table direct grants must be revoked');
  check(!/grant\s+(?:all|select|insert|update|delete)[^;]+on[^;]+table[^;]+to\s+authenticated/i.test(allSql),'No direct table grant to app role');
  check(/revoke all on all functions in schema eye_stock/i.test(allSql),'Private function defaults must be closed');
  check(!/\bexecute\s+(?!format\()/i.test(bodies),'Dynamic execution is allowed only in the fixed RLS format loop');
  return {issues,tables,functions,statementCount:statements.length};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const path=new URL('../supabase/sql/eye_stock_v1.sql',import.meta.url);const result=inspectMigration(readFileSync(path,'utf8'));
  console.log(JSON.stringify(result,null,2));if(result.issues.length)process.exitCode=1;
  console.log('LEXICAL/STRUCTURAL CHECK ONLY. PostgreSQL syntax, PL/pgSQL, privileges and concurrency remain unverified.');
}
