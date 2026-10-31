import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { DEFAULT_RESERVE_DAYS, validReserveDays } from '../lib/preferences.ts';
import { initialize, applyCommand } from '../lib/inventory.ts';
import { defaultMedications } from '../lib/model.ts';
import { mutationArgs } from '../lib/db-contract.ts';
import { prescriptionEstimate } from '../lib/forecast.ts';
import OpeningPlanPanel from '../components/opening-plan-panel.tsx';
import { splitStatements } from '../scripts/sql-static.mjs';
const today='2026-10-31';let id=0;const ids=()=>`prefs-${++id}`;
function state(){return initialize(defaultMedications().map(medication=>({medication,stock:3,activeDates:Array(medication.parallel).fill('2026-10-15'),historicalDates:medication.parallel===2?['2026-08-16','2026-08-16','2026-09-15','2026-09-15']:['2026-08-16','2026-09-15']})),today,'2026-11-15',ids);}
test('new accounts start with the shared initial reserve days value',()=>{
  assert.equal(state().reserveDays,DEFAULT_RESERVE_DAYS);assert.equal(DEFAULT_RESERVE_DAYS,14);
});
test('saving reserve days only changes the preference and operation bookkeeping',()=>{
  const before=state();const after=applyCommand(before,{action:'preferences',reserveDays:30},'save-prefs',before.revision,today,ids);
  assert.equal(after.reserveDays,30);assert.equal(before.reserveDays,14);assert.equal(after.revision,before.revision+1);
  for(const key of ['medications','bottles','movements','receipts','visits','nextVisitOn','initializedOn'] as const)assert.deepEqual(after[key],before[key]);
  assert.equal(applyCommand(after,{action:'preferences',reserveDays:30},'save-prefs',before.revision,today,ids),after);
  assert.throws(()=>applyCommand(after,{action:'preferences',reserveDays:45},'other-device',before.revision,today,ids),/別の操作/);
});
test('both boundaries are supported and invalid preferences cannot be saved',()=>{
  for(const reserveDays of [0,90])assert.equal(applyCommand(state(),{action:'preferences',reserveDays},ids(),0,today,ids).reserveDays,reserveDays);
  for(const reserveDays of [-1,91,0.5,NaN,Infinity]){
    assert.equal(validReserveDays(reserveDays),false);
    assert.throws(()=>applyCommand(state(),{action:'preferences',reserveDays},ids(),0,today,ids),/0〜90/);
  }
});
test('preferences use the same operation ID and revision transport as inventory writes',()=>{
  const request=mutationArgs({action:'preferences',reserveDays:0},'00000000-0000-4000-8000-000000000001',2);
  assert.deepEqual(request.payload,{reserveDays:0});assert.equal(request.action,'preferences');assert.equal(request.expected_revision,2);
});
test('the saved value drives the plan input and existing prescription calculator, including zero',()=>{
  const saved=applyCommand(state(),{action:'preferences',reserveDays:0},ids(),0,today,ids);
  const html=renderToStaticMarkup(createElement(OpeningPlanPanel,{state:saved,today,run:()=>true}));
  assert.ok(html.includes('共通の予備日数を保存'));assert.ok(html.includes('保存済み：0日'));assert.ok(html.includes('value="0"'));
  assert.equal(prescriptionEstimate(saved,'eybelis',today,'2026-11-15').endOn,'2027-02-15');
  assert.equal(prescriptionEstimate(state(),'eybelis',today,'2026-11-15').endOn,'2027-03-01');
});
test('database extension is scoped to Eye and retains owner locking and full-payload replay checks',async()=>{
  const sql=await readFile(new URL('../supabase/sql/eye_stock_reserve_days.sql',import.meta.url),'utf8');
  assert.equal(splitStatements(sql).length,8);
  assert.ok(!/security definer|alter role|create role|lens_stock\.|auth\.|drop |disable row level/i.test(sql));
  assert.ok(sql.includes('check(reserve_days between 0 and 90)'));
  assert.ok(sql.includes('grant update(reserve_days) on eye_stock.profiles to authenticated'));
  assert.ok(sql.includes("'reserveDays',p.reserve_days"));
  assert.ok(sql.includes("when 'preferences' then array['reserveDays']"));
  assert.ok(sql.includes("reserve_days=eye_stock.int_value(payload->'reserveDays',0,90)"));
  assert.ok(sql.indexOf('for update')<sql.indexOf('previous.payload is distinct from payload'));
  assert.ok(sql.indexOf('previous.payload is distinct from payload')<sql.indexOf('profile.revision<>expected_revision'));
});
