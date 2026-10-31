import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { addMonths } from '../lib/dates.ts';
import { initialize, applyCommand } from '../lib/inventory.ts';
import { defaultMedications, stockFor } from '../lib/model.ts';
import { recentEstimate, sixMonthOpeningPlan, validConsultation } from '../lib/opening-plan.ts';
import OpeningPlanPanel from '../components/opening-plan-panel.tsx';
const today='2026-10-31';let seq=0;const ids=()=>`plan-${++seq}`;
const options={nextVisitOn:'2026-11-15',followingVisitOn:'2027-02-15',reserveDays:14};
function fixture(stock=2){
  return initialize(defaultMedications().map(medication=>({medication,stock,activeDates:Array(medication.parallel).fill('2026-10-15'),historicalDates:medication.parallel===2?['2026-08-16','2026-08-16','2026-09-15','2026-09-15']:['2026-08-16','2026-09-15']})),today,'2026-11-15',ids);
}
test('recent opening intervals are weighted toward the latest usage pattern',()=>{
  const med=defaultMedications()[1];
  const state=initialize([{medication:med,stock:2,activeDates:['2026-10-15'],historicalDates:['2026-08-01','2026-09-15']}],today,null,ids);
  const estimate=recentEstimate(med,state);
  assert.deepEqual(estimate.samples,[45,30]);assert.deepEqual(estimate.weights,[1,2]);assert.equal(estimate.days,35);
  assert.equal(sixMonthOpeningPlan(state,today).openings[0].date,'2026-11-19');
});
test('recent actual empty-bottle durations retain priority and chronological weights',()=>{
  const state=fixture();const med=state.medications[1];
  const bottle=state.bottles.find(b=>b.medicationId===med.id)!;
  state.bottles.push({...bottle,id:ids(),openedOn:'2026-07-01',endedOn:'2026-08-10',status:'finished',endReason:'empty'},
    {...bottle,id:ids(),openedOn:'2026-08-15',endedOn:'2026-09-14',status:'finished',endReason:'empty'},
    {...bottle,id:ids(),openedOn:'2026-10-01',endedOn:'2026-10-21',status:'finished',endReason:'empty'});
  const estimate=recentEstimate(med,state);assert.equal(estimate.source,'actual');assert.deepEqual(estimate.samples,[40,30,20]);assert.equal(estimate.days,27);
});
test('six calendar months are exclusive at the end, sorted across drugs, with same-day dual demand',()=>{
  const plan=sixMonthOpeningPlan(fixture(1),today,options);
  assert.equal(plan.until,addMonths(today,6));assert.equal(plan.until,'2027-04-30');
  assert.ok(plan.openings.every((o,i)=>o.date>=today&&o.date<plan.until&&(i===0||plan.openings[i-1].date<=o.date)));
  const first=plan.openings.find(o=>o.medicationId==='dolmorol')!;
  assert.deepEqual(first,{date:'2026-11-14',medicationId:'dolmorol',quantity:2,stockCovered:1,uncovered:1});
});
test('prescription uses the following appointment, reserve days, and stock remaining after pre-visit demand',()=>{
  const plan=sixMonthOpeningPlan(fixture(),today,options);
  const p=plan.medications.find(m=>m.medication.id==='eybelis')!.consultation!;
  assert.equal(p.endOn,'2027-03-01');assert.equal(p.beforeVisit,1);assert.equal(p.remainingAtVisit,1);assert.equal(p.required,3);assert.equal(p.quantity,2);assert.ok(p.conservativeQuantity!>=p.quantity!);
});
test('appointment day demand is counted at next visit; following day is excluded unless buffered',()=>{
  const state=fixture();const opts={nextVisitOn:'2026-11-14',followingVisitOn:'2027-02-12',reserveDays:0};
  const normal=sixMonthOpeningPlan(state,today,opts).medications[1].consultation!;
  const buffered=sixMonthOpeningPlan(state,today,{...opts,reserveDays:1}).medications[1].consultation!;
  assert.equal(normal.beforeVisit,0);assert.equal(normal.required,3);assert.equal(buffered.required,4);
  assert.equal(buffered.quantity,normal.quantity!+1);
});
test('pre-visit shortages are flagged separately; pending prescriptions never count as stock',()=>{
  let state=fixture(0);
  state=applyCommand(state,{action:'receipt',medicationId:'eybelis',prescribedOn:today,prescribedQuantity:100,receivedOn:null,receivedQuantity:0,note:'',visitId:null},'pending',state.revision,today,ids);
  const plan=sixMonthOpeningPlan(state,today,options);const p=plan.medications[1].consultation!;
  assert.equal(p.shortfallBeforeVisit,1);assert.equal(p.remainingAtVisit,0);assert.equal(p.quantity,p.required);
});
test('a real replacement recalculates evidence and dates without materializing forecast records',()=>{
  const state=fixture(3);const before=JSON.stringify(state);const oldPlan=sixMonthOpeningPlan(state,today,options);
  const active=state.bottles.find(b=>b.medicationId==='eybelis'&&b.status==='in_use')!;
  const next=applyCommand(state,{action:'open',medicationId:'eybelis',date:today,replaceId:active.id,replacementReason:'empty'},'replace',state.revision,today,ids);
  const updated=sixMonthOpeningPlan(next,today,options);assert.equal(updated.medications[1].estimate.days,16);
  assert.notEqual(oldPlan.openings.find(o=>o.medicationId==='eybelis')!.date,updated.openings.find(o=>o.medicationId==='eybelis')!.date);
  assert.equal(JSON.stringify(state),before);assert.equal(stockFor(next,'eybelis'),2);assert.equal(next.bottles.length,state.bottles.length+1);
  const nextBefore=JSON.stringify(next);sixMonthOpeningPlan(next,today,options);assert.equal(JSON.stringify(next),nextBefore);
});
test('missing history shows no invented dates or prescription quantities',()=>{
  const state=initialize(defaultMedications().map(medication=>({medication,stock:2,activeDates:[],historicalDates:[]})),today,null,ids);
  const plan=sixMonthOpeningPlan(state,today,options);assert.equal(plan.openings.length,0);
  for(const med of plan.medications){assert.equal(med.estimate.confidence,'low');assert.equal(med.consultation!.quantity,null);}
  const html=renderToStaticMarkup(createElement(OpeningPlanPanel,{state,today}));assert.ok(html.includes('履歴不足'));assert.ok(html.includes('算出できません'));
});
test('invalid or cleared dates and invalid reserve days are rejected without entering an unbounded schedule',()=>{
  for(const opts of [{...options,nextVisitOn:''},{...options,followingVisitOn:options.nextVisitOn},{...options,reserveDays:-1},{...options,reserveDays:0.5},{...options,reserveDays:91},{...options,reserveDays:NaN}]){
    assert.equal(validConsultation(today,opts),false);assert.throws(()=>sixMonthOpeningPlan(fixture(),today,opts));
  }
});
test('schedule respects configured expiry, flags overdue dates and preserves real bottle status',()=>{
  const state=fixture();for(const med of state.medications){med.expirationDays=10;med.expirationSource='confirmed';}
  for(const bottle of state.bottles)bottle.expirationDays=10;
  const plan=sixMonthOpeningPlan(state,today);assert.equal(plan.openings[0].date,today);assert.ok(plan.medications.every(m=>m.overdue));assert.ok(state.bottles.some(b=>b.status==='in_use'));
});
test('consultation cards and upcoming predictions render separately from actual history',()=>{
  const html=renderToStaticMarkup(createElement(OpeningPlanPanel,{state:fixture(),today}));
  for(const label of ['今後6か月','今後の開封予定一覧','次回診察日','次々回診察日','予備日数','直近ほど重く','予測','実際の開封履歴とは別','ドルモロール','エイベリス'])assert.ok(html.includes(label),label);
  assert.ok(!html.includes('朝用'));assert.ok(!html.includes('夜用'));assert.ok(html.includes('不確実性'));
});
