import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, differenceDays, japanToday, validDate } from '../lib/dates.ts';
import { defaultMedications, stockFor, activeBottles } from '../lib/model.ts';
import type { Bottle, State } from '../lib/model.ts';
import { applyCommand, initialize, InventoryError } from '../lib/inventory.ts';
import type { Command } from '../lib/inventory.ts';
import { estimateDuration, forecastMedication, openingSchedule, prescriptionEstimate } from '../lib/forecast.ts';
import { errorMessage, localCapabilities, readWithBackoff } from '../lib/transport.ts';

const today='2026-10-31';let seq=0;const ids=()=>`id-${++seq}`;
function initial(stock=3):State {
  return initialize(defaultMedications().map(m=>({medication:m,stock,activeDates:[],historicalDates:[]})),today,null,ids);
}
function command(s:State,c:Command,id=ids(),revision=s.revision){return applyCommand(s,c,id,revision,today,ids);}
function histories(id='dolmorol'):Bottle[]{
  const med=defaultMedications().find(m=>m.id===id)!;
  const dates=id==='dolmorol'?['2026-06-01','2026-06-01','2026-07-01','2026-07-01','2026-07-31','2026-07-31']:['2026-08-01','2026-08-31','2026-09-30'];
  return dates.map(openedOn=>({id:ids(),medicationId:id,openedOn,origin:'historical',status:'historical',endedOn:null,endReason:null,replacesId:null,version:1,parallel:med.parallel,expirationDays:null}));
}
test('JST midnight and leap dates are timezone independent',()=>{
  assert.equal(japanToday(new Date('2026-10-30T15:00:00Z')),today);
  assert.equal(japanToday(new Date('2026-10-30T14:59:59Z')),'2026-10-30');
  assert.equal(validDate('2024-02-29'),true);assert.equal(validDate('2026-02-29'),false);
  assert.equal(differenceDays('2024-02-28','2024-03-01'),2);
});
test('three calendar months clamp month end without timezone rollover',()=>{
  assert.equal(addMonths('2026-01-31',3),'2026-04-30');
  assert.equal(addMonths('2023-11-30',3),'2024-02-29');
  assert.equal(addMonths('2024-11-30',3),'2025-02-28');
  assert.equal(addDays('2026-12-31',1),'2027-01-01');
});
test('wizard historical and initial active bottles never subtract present stock',()=>{
  const med=defaultMedications()[0];const s=initialize([{medication:med,stock:5,activeDates:['2026-10-01','2026-10-02'],historicalDates:['2026-06-01','2026-06-01']}],today,null,ids);
  assert.equal(stockFor(s,med.id),5);assert.equal(activeBottles(s,med.id).length,2);assert.equal(new Set(s.bottles.map(b=>b.id)).size,4);
});
test('opening consumes exactly one, preserves input and assigns a unique bottle',()=>{
  const s=initial();const a=command(s,{action:'open',medicationId:'dolmorol',date:today});
  const b=command(a,{action:'open',medicationId:'dolmorol',date:today});
  assert.equal(stockFor(s,'dolmorol'),3);assert.equal(stockFor(b,'dolmorol'),1);
  assert.equal(activeBottles(b,'dolmorol').length,2);assert.notEqual(b.bottles[0].id,b.bottles[1].id);
});
test('zero stock rejects opening atomically',()=>{
  const s=initial(0);assert.throws(()=>command(s,{action:'open',medicationId:'eybelis',date:today}),(e:unknown)=>e instanceof InventoryError&&e.code==='NO_STOCK');
  assert.equal(s.bottles.length,0);assert.equal(s.revision,0);
});
test('parallel limit requires an explicit single-bottle replacement',()=>{
  let s=initial(4);s=command(s,{action:'open',medicationId:'dolmorol',date:today});s=command(s,{action:'open',medicationId:'dolmorol',date:today});
  assert.throws(()=>command(s,{action:'open',medicationId:'dolmorol',date:today}),/選び/);
  const old=activeBottles(s,'dolmorol')[0];const other=activeBottles(s,'dolmorol')[1];
  const a=command(s,{action:'open',medicationId:'dolmorol',date:today,replaceId:old.id,replacementReason:'empty'});
  assert.equal(a.bottles.find(b=>b.id===old.id)?.status,'finished');
  assert.equal(a.bottles.find(b=>b.id===other.id)?.status,'in_use');assert.equal(stockFor(a,'dolmorol'),1);
});
test('ending/discarding one selected bottle does not alter unopened inventory',()=>{
  const s=command(initial(),{action:'open',medicationId:'dolmorol',date:today});
  const a=command(s,{action:'end',bottleId:s.bottles[0].id,date:today,reason:'discarded'});
  assert.equal(stockFor(a,'dolmorol'),2);assert.equal(activeBottles(a,'dolmorol').length,0);
});
test('historical import and correction leave stock unchanged; future dates rejected',()=>{
  const s=command(initial(),{action:'import',medicationId:'dolmorol',date:'2026-06-01'});
  const a=command(s,{action:'edit_opening',bottleId:s.bottles[0].id,date:'2026-06-02'});
  assert.equal(stockFor(a,'dolmorol'),3);assert.equal(a.bottles[0].openedOn,'2026-06-02');
  assert.throws(()=>command(a,{action:'import',medicationId:'dolmorol',date:'2026-11-01'}),/日付/);
  assert.throws(()=>command(a,{action:'import',medicationId:'dolmorol',date:'2026-05-31'}),/日付/);
});
test('opening cancellation credits only normal origins and cannot credit twice',()=>{
  const s=command(initial(),{action:'open',medicationId:'eybelis',date:today});
  const a=command(s,{action:'cancel_opening',bottleId:s.bottles[0].id});assert.equal(stockFor(a,'eybelis'),3);
  assert.throws(()=>command(a,{action:'cancel_opening',bottleId:s.bottles[0].id}),/見つかりません/);
  const h=command(initial(),{action:'import',medicationId:'eybelis',date:'2026-06-01'});
  assert.equal(stockFor(command(h,{action:'cancel_opening',bottleId:h.bottles[0].id}),'eybelis'),3);
});
test('dependent replacement and ended bottle cannot be silently undone',()=>{
  const s=command(initial(),{action:'open',medicationId:'eybelis',date:today});
  const a=command(s,{action:'open',medicationId:'eybelis',date:today,replaceId:s.bottles[0].id,replacementReason:'empty'});
  assert.throws(()=>command(a,{action:'cancel_opening',bottleId:a.bottles[0].id}),/取り消せません/);
  assert.throws(()=>command(a,{action:'cancel_opening',bottleId:a.bottles[1].id}),/取り消せません/);
});
test('prescription alone does not increase stock; later receipt increases once',()=>{
  const s=command(initial(),{action:'receipt',medicationId:'eybelis',prescribedOn:today,prescribedQuantity:3,receivedOn:null,receivedQuantity:0,note:'',visitId:null});
  assert.equal(stockFor(s,'eybelis'),3);
  const a=command(s,{action:'receive',receiptId:s.receipts[0].id,date:today,quantity:3});
  assert.equal(stockFor(a,'eybelis'),6);
  assert.throws(()=>command(a,{action:'receive',receiptId:s.receipts[0].id,date:today,quantity:3}),/受取/);
});
test('receipt cancel cannot cause negative stock',()=>{
  let s=command(initial(0),{action:'receipt',medicationId:'eybelis',prescribedOn:today,prescribedQuantity:1,receivedOn:today,receivedQuantity:1,note:'',visitId:null});
  const receiptId=s.receipts[0].id;s=command(s,{action:'open',medicationId:'eybelis',date:today});
  assert.throws(()=>command(s,{action:'cancel_receipt',receiptId}),/負数/);
});
test('idempotent replay returns current state even after later updates; changed payload rejected',()=>{
  const c:Command={action:'open',medicationId:'eybelis',date:today};let s=command(initial(),c,'same');
  s=command(s,{action:'adjust',medicationId:'dolmorol',quantity:8,note:'実数'});
  assert.equal(command(s,c,'same',0),s);assert.equal(stockFor(s,'eybelis'),2);
  assert.throws(()=>command(s,{...c,medicationId:'dolmorol'},'same'),/再利用/);
});
test('stale revision simulates two-device conflict without losing inventory',()=>{
  const s=initial();const a=command(s,{action:'open',medicationId:'eybelis',date:today});
  assert.throws(()=>command(a,{action:'adjust',medicationId:'eybelis',quantity:99,note:'実数'},ids(),s.revision),(e:unknown)=>e instanceof InventoryError&&e.code==='CONFLICT');
  assert.equal(stockFor(a,'eybelis'),2);
});
test('invalid and foreign bottle IDs cannot select another drug',()=>{
  const s=command(initial(),{action:'open',medicationId:'eybelis',date:today});
  assert.throws(()=>command(s,{action:'open',medicationId:'dolmorol',date:today,replaceId:s.bottles[0].id,replacementReason:'empty'}),/切替/);
  assert.throws(()=>command(s,{action:'end',bottleId:'unknown',date:today,reason:'empty'}),/見つかりません/);
});
test('Eybelis uses last three opening dates (two intervals)',()=>{
  const h=histories('eybelis');const older={...h[0],id:ids(),openedOn:'2026-06-01'};
  const e=estimateDuration(defaultMedications()[1],[older,...h]);assert.deepEqual(e.samples,[30,30]);assert.equal(e.days,30);assert.equal(e.confidence,'low');
});
test('Dolmorol same-day pairs use two-openings-back rather than zero-day adjacent gaps',()=>{
  const e=estimateDuration(defaultMedications()[0],histories());assert.deepEqual(e.samples,[30,30,30,30]);assert.equal(e.days,30);
});
test('staggered dual bottles are supported',()=>{
  const h=histories();['2026-06-01','2026-06-05','2026-07-01','2026-07-06','2026-07-31','2026-08-06'].forEach((d,i)=>h[i].openedOn=d);
  assert.deepEqual(estimateDuration(defaultMedications()[0],h).samples,[30,31,30,31]);
});
test('actual empty-bottle lifetime takes priority over opening proxies; discarded excluded',()=>{
  const h=histories();h[0]={...h[0],status:'finished',endedOn:'2026-06-21',endReason:'empty'};
  h[1]={...h[1],status:'discarded',endedOn:'2026-06-03',endReason:'discarded'};
  const e=estimateDuration(defaultMedications()[0],h);assert.equal(e.source,'actual');assert.equal(e.days,20);
});
test('insufficient history never invents a duration or prescription number',()=>{
  const s=initial();assert.equal(forecastMedication(s,'eybelis',today).nextOpen,null);
  assert.equal(prescriptionEstimate(s,'eybelis',today,'2026-11-15').quantity,null);
});
test('variability produces a warning and a range',()=>{
  const h=histories('eybelis');h[0].openedOn='2026-06-01';h[1].openedOn='2026-08-01';
  const e=estimateDuration(defaultMedications()[1],h);assert.equal(e.fastDays,60);assert.equal(e.slowDays,61);
  h[0].openedOn='2026-07-25';const varied=estimateDuration(defaultMedications()[1],h);assert.ok(varied.warnings.some(w=>w.includes('ばらつき')));
});
test('last unopened opening and first unsupported opening are different dates',()=>{
  const med=defaultMedications()[1];const s=initialize([{medication:med,stock:2,activeDates:['2026-10-15'],historicalDates:['2026-08-16','2026-09-15']}],today,null,ids);
  const f=forecastMedication(s,med.id,today);assert.equal(f.nextOpen,'2026-11-14');assert.equal(f.lastUnopened,'2026-12-14');assert.equal(f.shortage,'2027-01-13');
});
test('two same-day replacements with one reserve fail on that day, not one month later',()=>{
  const med=defaultMedications()[0];const s=initialize([{medication:med,stock:1,activeDates:['2026-10-15','2026-10-15'],historicalDates:['2026-09-15','2026-09-15']}],today,null,ids);
  const f=forecastMedication(s,med.id,today);assert.equal(f.lastUnopened,'2026-11-14');assert.equal(f.shortage,'2026-11-14');
});
test('expiry caps projected lifetime but never mutates real stock or bottle state',()=>{
  const med={...defaultMedications()[1],expirationDays:20,expirationSource:'ユーザー確認済み条件'};
  const s=initialize([{medication:med,stock:2,activeDates:['2026-10-01'],historicalDates:['2026-08-02','2026-09-01']}],today,null,ids);
  const f=forecastMedication(s,med.id,today);assert.equal(f.overdue,true);assert.equal(f.nextOpen,today);assert.equal(stockFor(s,med.id),2);assert.equal(s.bottles[0].status,'in_use');
});
test('new medication settings do not rewrite opened-bottle expiry or train from old regime',()=>{
  const med=defaultMedications()[1];const s=initialize([{medication:med,stock:2,activeDates:['2026-10-01'],historicalDates:['2026-08-02','2026-09-01']}],today,null,ids);
  const a=command(s,{action:'settings',medication:{...med,expirationDays:20,expirationSource:'設定'}});
  assert.equal(a.bottles[0].expirationDays,null);assert.equal(estimateDuration(a.medications[0],a.bottles).days,null);
});
test('prescription simulates discrete parallel demand, excludes pending receipts and flags pre-visit shortage',()=>{
  const med=defaultMedications()[0];let s=initialize([{medication:med,stock:0,activeDates:['2026-10-15','2026-10-15'],historicalDates:['2026-09-15','2026-09-15']}],today,null,ids);
  const e=prescriptionEstimate(s,med.id,today,'2026-11-01');assert.equal(e.endOn,'2027-02-15');assert.equal(e.quantity,8);assert.ok(e.conservativeQuantity!>=e.quantity!);
  s=command(s,{action:'receipt',medicationId:med.id,prescribedOn:today,prescribedQuantity:100,receivedOn:null,receivedQuantity:0,note:'',visitId:null});
  assert.equal(prescriptionEstimate(s,med.id,today,'2026-11-01').quantity,8);
  assert.equal(prescriptionEstimate(s,med.id,today,'2026-12-01').shortageBeforeVisit,true);
});
test('forecast horizon is finite and no schedule includes its exclusive end',()=>{
  const med=defaultMedications()[0];assert.deepEqual(openingSchedule(med,[],today,30,'2026-11-30').dates,[today,today]);
  assert.throws(()=>openingSchedule(med,[],today,0,'2026-11-30'));
});
test('normal opening before initialization cannot double-subtract historical stock',()=>{
  assert.throws(()=>command(initial(),{action:'open',medicationId:'eybelis',date:'2026-10-30'}),/過去履歴/);
});
test('visit picks latest visit chronologically rather than last input order',()=>{
  let s=command(initial(),{action:'visit',date:'2026-10-20',nextDate:'2027-01-20',note:''});
  s=command(s,{action:'visit',date:'2026-09-20',nextDate:'2026-12-20',note:''});assert.equal(s.nextVisitOn,'2027-01-20');
});
test('read retry uses bounded 1s/2s backoff and does not retry business conflicts',async()=>{
  let calls=0;const waits:number[]=[];
  await assert.rejects(readWithBackoff(async()=>{calls++;throw new Error('offline');},()=>true,async ms=>{waits.push(ms);}));
  assert.equal(calls,3);assert.deepEqual(waits,[1000,2000]);
  calls=0;await assert.rejects(readWithBackoff(async()=>{calls++;throw new Error('conflict');},()=>false,async()=>{}));assert.equal(calls,1);
});
test('passkeys cannot be described as implemented; PT409 is a finite conflict message',()=>{
  assert.equal(localCapabilities.passkey,'not_implemented');assert.ok(errorMessage('PT409','').includes('別の端末'));assert.equal(localCapabilities.emailOtp,false);
});
test('pre-initialization receipt cannot be counted again',()=>{
  assert.throws(()=>command(initial(),{action:'receipt',medicationId:'eybelis',prescribedOn:'2026-09-01',prescribedQuantity:3,receivedOn:'2026-09-02',receivedQuantity:3,note:'',visitId:null}),/重複加算/);
});
test('initial next appointment cannot be in the past',()=>{
  const m=defaultMedications()[0];assert.throws(()=>initialize([{medication:m,stock:0,activeDates:[],historicalDates:[]}],today,'2026-10-30',ids),/受診日/);
});
test('expiry requires a user-provided source and never gets an invented default',()=>{
  assert.equal(defaultMedications()[0].expirationDays,null);
  const m={...defaultMedications()[0],expirationDays:30};assert.throws(()=>initialize([{medication:m,stock:0,activeDates:[],historicalDates:[]}],today,null,ids),/根拠/);
});
test('a sequence of corrections preserves the inventory ledger',()=>{
  let s=initial(1);const receive:Command={action:'receipt',medicationId:'eybelis',prescribedOn:today,prescribedQuantity:3,receivedOn:today,receivedQuantity:3,note:'',visitId:null};
  s=command(s,receive,'r');const receipt=s.receipts[0];s=command(s,{action:'open',medicationId:'eybelis',date:today},'o');const b=s.bottles[0];
  s=command(s,{action:'cancel_opening',bottleId:b.id});s=command(s,{action:'cancel_receipt',receiptId:receipt.id});
  assert.equal(stockFor(s,'eybelis'),1);assert.equal(s.movements.filter(m=>m.kind==='opening_cancel').length,1);
  assert.equal(command(s,receive,'r',0),s);
});
test('forecasting never changes source inventory even when projections are overdue',()=>{
  const s=initial();s.bottles=histories();const before=JSON.stringify(s);
  forecastMedication(s,'dolmorol',today);prescriptionEstimate(s,'dolmorol',today,'2026-12-01');assert.equal(JSON.stringify(s),before);
});
