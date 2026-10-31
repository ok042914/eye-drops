import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { inspectMigration, splitStatements, tokenizeSql } from '../scripts/sql-static.mjs';
import { mutationArgs, initializationArgs, operationDecision } from '../lib/db-contract.ts';
import { defaultMedications } from '../lib/model.ts';
const sql=await readFile(new URL('../supabase/sql/eye_stock_v1.sql',import.meta.url),'utf8');
const op='00000000-0000-4000-8000-000000000001';
test('candidate contains only dedicated schema tables, scoped public wrappers and a transaction',()=>{
  const result=inspectMigration(sql);assert.deepEqual(result.issues,[]);assert.equal(result.tables.length,11);
  assert.deepEqual(result.functions.filter(n=>n.startsWith('public.')).sort(),['public.eye_stock_history','public.eye_stock_mutate','public.eye_stock_operation_status','public.eye_stock_snapshot']);
});
test('static checker rejects accidental cross-application changes',()=>{
  for(const danger of ['update lens_stock.profiles set revision=0;','update public.another_app set value=0;','alter table public.itsuka_box_tasks disable row level security;','grant select on public.another_app to authenticated;','grant eye_stock_executor to authenticated;','drop schema public cascade;','alter role authenticated bypassrls;'])
    assert.ok(inspectMigration(sql.replace(/commit;\s*$/,danger+'\ncommit;')).issues.length>0,danger);
});
test('static checker rejects retryable business error codes and mutable/public definer functions',()=>{
  assert.ok(inspectMigration(sql.replace("raise sqlstate 'PT409'","raise sqlstate '40001'")).issues.length>0);
  assert.ok(inspectMigration(sql.replace("raise sqlstate 'PT409'","raise sqlstate '40P01'")).issues.length>0);
  assert.ok(inspectMigration(sql.replace("language sql stable security invoker",'language sql stable security definer')).issues.length>0);
});
test('lexer handles semicolons in bodies, quoted strings, comments; rejects truncated SQL',()=>{
  assert.equal(splitStatements("begin; -- ;\n do $x$ begin perform ';'; end $x$; commit;").length,3);
  assert.throws(()=>tokenizeSql("select 'unterminated"));assert.throws(()=>tokenizeSql('do $x$ unfinished'));
  assert.throws(()=>splitStatements('select 1'));
});
test('every Phase-2 command is covered by the SQL action allowlist',async()=>{
  const source=ts.createSourceFile('inventory.ts',await readFile(new URL('../lib/inventory.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
  const alias=source.statements.find(n=>ts.isTypeAliasDeclaration(n)&&n.name.text==='Command') as ts.TypeAliasDeclaration;
  assert.ok(ts.isUnionTypeNode(alias.type));
  const actions=(alias.type as ts.UnionTypeNode).types.map(type=>{
    assert.ok(ts.isTypeLiteralNode(type));const prop=(type as ts.TypeLiteralNode).members.find(m=>ts.isPropertySignature(m)&&m.name.getText(source)==='action') as ts.PropertySignature;
    return ((prop.type as ts.LiteralTypeNode).literal as ts.StringLiteral).text;
  });
  const allowlist=sql.slice(sql.indexOf('allowed_keys:=case action'),sql.indexOf('-- Serialize ALL'));
  for(const action of actions)assert.ok(allowlist.includes(`when '${action}' then`),action);
  assert.ok(allowlist.includes("when 'initialize' then"));
});
test('replay is checked under owner lock before revision and compares full JSONB payload',()=>{
  const fn=sql.slice(sql.indexOf('create function eye_stock.mutate'),sql.indexOf('create function eye_stock.operation_status'));
  assert.ok(fn.indexOf('for update')<fn.indexOf('previous from eye_stock.mutation_requests'));
  assert.ok(fn.indexOf('previous.payload is distinct from payload')<fn.indexOf('profile.revision<>expected_revision'));
  assert.ok(fn.includes("raise sqlstate 'PT409' using message='EYE_RETRY_MISMATCH'"));
  assert.ok(fn.includes('insert into eye_stock.mutation_requests'));assert.ok(fn.includes('insert into eye_stock.audit_events'));
});
test('normal open is one bottle/minus one; history and usage-end have no inventory movement',()=>{
  const cases=sql.slice(sql.indexOf('    case action\n'));
  const body=cases.slice(cases.indexOf("    when 'open' then"),cases.indexOf("    when 'edit_opening','cancel_opening' then"));
  const open=body.slice(0,body.indexOf("    when 'import' then"));assert.ok(open.includes("mid,-1,'opening'"));assert.ok(open.includes('replaces_id'));
  const after=body.slice(body.indexOf("    when 'import' then"));assert.ok(!after.includes('perform eye_stock.move_stock'));
});
test('unique ledger constraints and balance postcondition cover repeat credits and negative stock',()=>{
  assert.ok(sql.includes('check(quantity between 0 and 100000)'));
  assert.ok(sql.includes('quantity+amount between 0 and 100000'));
  assert.ok(sql.includes('eye_stock_bottle_movement_once'));assert.ok(sql.includes('eye_stock_receipt_movement_once'));
  assert.ok(sql.includes('coalesce(sum(m.delta),0)'));assert.ok(sql.includes('EYE_LEDGER_MISMATCH'));
  assert.ok(sql.includes("candidate.origin='normal'"));
});
test('request builder strips action/undefined fields and preserves operation ID for safe resubmission',()=>{
  const request=mutationArgs({action:'open',medicationId:'dolmorol',date:'2026-10-31',replaceId:undefined},op,3);
  assert.equal(request.action,'open');assert.equal(request.operation_id,op);assert.equal(request.expected_revision,3);
  assert.deepEqual(request.payload,{medicationId:'dolmorol',date:'2026-10-31'});
  assert.throws(()=>mutationArgs({action:'cancel_opening',bottleId:op},'bad-id',3));
});
test('initializer and pending-status contract never invent successful completion',()=>{
  const items=defaultMedications().map(medication=>({medication,stock:3,activeDates:[],historicalDates:[]}));
  const request=initializationArgs(items,null,op);assert.equal(request.action,'initialize');assert.equal(request.expected_revision,0);
  assert.equal(operationDecision({status:'unknown',operationId:op}),'keep_pending');
  assert.equal(operationDecision({status:'committed',operationId:op,completedRevision:1}),'refresh');
});
test('unapproved role design fails before role creation and runtime lock waiting is finite',()=>{
  assert.ok(sql.indexOf('EYE_ROLE_DESIGN_REAPPROVAL_REQUIRED')<sql.indexOf('create role eye_stock_executor'));
  assert.ok(sql.includes("select rolsuper from pg_roles where rolname=current_user"));
  assert.ok(sql.includes("set lock_timeout='1s'"));
  assert.ok(sql.includes("when lock_not_available then raise sqlstate 'PT409' using message='EYE_BUSY'"));
  assert.ok(sql.includes('EYE_UNEXPECTED_ROLE_MEMBERSHIP'));
  assert.ok(sql.includes('EYE_UNEXPECTED_DIRECT_PRIVILEGE'));
});
test('isolated security test covers all tables and cannot silently run in a normal database',async()=>{
  const suite=await readFile(new URL('../supabase/tests/security_isolated.sql',import.meta.url),'utf8');
  assert.doesNotThrow(()=>splitStatements(suite));
  for(const name of inspectMigration(sql).tables)assert.ok(suite.includes(`'${name.split('.')[1]}'`));
  assert.ok(suite.indexOf('ISOLATED_TEST_DATABASE_AND_EXPLICIT_OPT_IN_REQUIRED')<suite.indexOf('do $tests$'));
  assert.ok(suite.includes("current_database()<>'eye_drops_security_test'"));
  assert.ok(suite.includes("current_setting('eye_drops.isolated_tests',true)"));
  assert.ok(suite.trim().endsWith('rollback;'));
  assert.ok(suite.includes('DIRECT_READ_UNEXPECTEDLY_SUCCEEDED'));
  assert.ok(suite.includes('WITH_CHECK_UNEXPECTEDLY_SUCCEEDED'));
  assert.ok(suite.includes('UNENROLLED_RPC_UNEXPECTEDLY_SUCCEEDED'));
});
test('production invoker migration has no privileged owner, memberships or other-app DDL',async()=>{
  const production=await readFile(new URL('../supabase/sql/eye_stock_v1_invoker.sql',import.meta.url),'utf8');
  const statements=splitStatements(production);
  assert.ok(!/create role|alter role|owner to|security definer|raise sqlstate '(40001|40P01)'/i.test(production));
  assert.equal(statements.filter(s=>s[0]?.value==='create'&&s[1]?.value==='function').length,18);
  for(const stmt of statements){if(stmt[0]?.value==='create'&&stmt[1]?.value==='table')assert.equal(stmt[2]?.value,'eye_stock');}
  assert.ok(production.includes('verified_enrollment'));assert.ok(production.includes('[{"method":"otp"}]'));
  assert.ok(production.includes('grant insert(user_id) on eye_stock.profiles to authenticated'));
  assert.ok(production.includes("set lock_timeout='1s'"));
  assert.ok(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(production));
});
