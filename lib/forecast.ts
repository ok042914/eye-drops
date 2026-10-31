import { DEFAULT_RESERVE_DAYS } from './preferences.ts';
import { addDays, addMonths, differenceDays, validDate } from './dates.ts';
import { activeBottles, stockFor } from './model.ts';
import type { Bottle, Medication, State } from './model.ts';

export type Estimate = { days: number | null; fastDays: number | null; slowDays: number | null; samples: number[]; source: 'actual' | 'interval' | 'none'; confidence: 'low' | 'reference'; warnings: string[] };
export type Forecast = { estimate: Estimate; nextOpen: string | null; lastUnopened: string | null; shortage: string | null; earlyShortage: string | null; lateShortage: string | null; overdue: boolean; horizon: string; notes: string[] };
function median(values: number[]): number {
  const s = [...values].sort((a,b) => a-b); const i = Math.floor(s.length/2);
  return s.length % 2 ? s[i] : (s[i-1]+s[i])/2;
}
/** Use actual empty-bottle durations first. Calendar intervals are only proxies. */
export function estimateDuration(med: Medication, bottles: Bottle[], method: 'recent-median' | 'all-average' = 'recent-median'): Estimate {
  const valid = bottles.filter(b => b.medicationId === med.id && b.status !== 'cancelled' && b.version === med.version && b.parallel === med.parallel);
  const completed = valid.filter(b => b.endReason === 'empty' && b.endedOn && validDate(b.openedOn) && validDate(b.endedOn))
    .sort((a,b) => b.endedOn!.localeCompare(a.endedOn!));
  const measured = (method === 'all-average' ? completed : completed.slice(0,3))
    .map(b => differenceDays(b.openedOn, b.endedOn!));
  const warnings: string[] = [];
  const actual = measured.filter(n => n > 0 && n <= 365);
  if (actual.length !== measured.length) warnings.push('同日使い切り・365日超の期間は学習せず、履歴確認が必要です。');
  let samples = actual;
  let source: Estimate['source'] = actual.length ? 'actual' : 'none';
  if (!samples.length) {
    const history = valid.filter(b => b.status !== 'discarded').sort((a,b) => a.openedOn.localeCompare(b.openedOn) || a.id.localeCompare(b.id));
    const opened = method === 'all-average' ? history : history.slice(-(med.parallel === 1 ? 3 : Math.max(6,med.parallel+1)));
    const intervals = opened.slice(med.parallel).map((b,i) => differenceDays(opened[i].openedOn,b.openedOn));
    samples = intervals.filter(n => n > 0 && n <= 365);
    if (samples.length !== intervals.length) warnings.push('0日・365日超の開封間隔は学習せず、履歴確認が必要です。');
    if (samples.length) source = 'interval';
    if (med.parallel > 1 && source === 'interval') warnings.push(`${med.parallel}本前との開封間隔による参考値です。ボトル別の使い切り履歴が増えると優先します。`);
  }
  if (!samples.length) return { days:null, fastDays:null, slowDays:null, samples, source:'none', confidence:'low', warnings:[...warnings,'履歴不足のため日付・処方数量の目安を計算できません。'] };
  if (samples.length < 3) warnings.push(`有効な期間が${samples.length}件のため、精度は低めです。`);
  if (Math.max(...samples) >= Math.min(...samples)*1.5) warnings.push('期間のばらつきが大きいため、早めの不足目安も確認してください。');
  return { days:Math.max(1,Math.round(method === 'all-average' ? samples.reduce((sum,n) => sum+n,0)/samples.length : median(samples))), fastDays:Math.min(...samples), slowDays:Math.max(...samples), samples, source, confidence:samples.length<3?'low':'reference', warnings };
}

function lifetime(b: Bottle | undefined, med: Medication, days: number): number {
  const expiration = b ? b.expirationDays : med.expirationDays;
  return expiration === null ? days : Math.min(days, expiration);
}
/** Anonymous slots are a simulation only: real bottles always retain their own IDs. */
export function openingSchedule(med: Medication, bottles: Bottle[], today: string, days: number, until: string): { dates: string[]; overdue: boolean } {
  if (!validDate(today) || !validDate(until) || !Number.isInteger(days) || days < 1 || differenceDays(today,until)>1100 || until<today) throw new Error('予測期間を確認してください。');
  const active = bottles.filter(b=>b.medicationId===med.id&&b.status==='in_use');
  const queue: string[] = []; let overdue=false;
  for (let i=0;i<med.parallel;i++) {
    const b=active[i]; const due=b?addDays(b.openedOn,lifetime(b,med,days)):today;
    if(due<today)overdue=true;
    queue.push(due<today?today:due);
  }
  const dates: string[]=[];
  // Bounded: <=4 slots, <=1100 days, minimum lifetime 1 day.
  while (dates.length < 5000) {
    queue.sort(); const next=queue.shift()!;
    if(next>=until)break;
    dates.push(next); queue.push(addDays(next,lifetime(undefined,med,days)));
  }
  return { dates,overdue };
}
function datesForStock(schedule: string[], stock: number) {
  return { nextOpen:schedule[0]??null, lastUnopened:stock>0?schedule[stock-1]??null:null, shortage:schedule[stock]??null };
}
export function forecastMedication(state: State, medicationId: string, today: string): Forecast {
  const med=state.medications.find(m=>m.id===medicationId); if(!med)throw new Error('薬剤がありません。');
  const estimate=estimateDuration(med,state.bottles); const horizon=addDays(today,730);
  const empty:Forecast={estimate,nextOpen:null,lastUnopened:null,shortage:null,earlyShortage:null,lateShortage:null,overdue:false,horizon,notes:[]};
  if(estimate.days===null)return empty;
  const usual=openingSchedule(med,state.bottles,today,estimate.days,horizon);
  const fast=openingSchedule(med,state.bottles,today,estimate.fastDays!,horizon);
  const slow=openingSchedule(med,state.bottles,today,estimate.slowDays!,horizon);
  const stock=stockFor(state,med.id);
  return {...empty,...datesForStock(usual.dates,stock),earlyShortage:datesForStock(fast.dates,stock).shortage,lateShortage:datesForStock(slow.dates,stock).shortage,overdue:usual.overdue,
    notes:[...(usual.overdue?['交換の目安を過ぎた使用中ボトルがあります。残量・開封記録を確認してください。']:[]),...(activeBottles(state,med.id).length<med.parallel?['使用中本数が設定より少ないため、不足分は今日開封する想定です。']:[]),'予測範囲は今日から2年。期間の幅は統計的な信頼区間ではありません。']};
}
export type PrescriptionEstimate = { quantity:number|null; conservativeQuantity:number|null; remainingAtVisit:number|null; required:number|null; endOn:string; shortageBeforeVisit:boolean; note:string };
export function prescriptionEstimate(state:State,medicationId:string,today:string,visitOn:string):PrescriptionEstimate {
  if(!validDate(visitOn)||visitOn<today||differenceDays(today,visitOn)>730)throw new Error('次回受診日は今日から2年以内で指定してください。');
  const med=state.medications.find(m=>m.id===medicationId);if(!med)throw new Error('薬剤がありません。');
  const estimate=estimateDuration(med,state.bottles); const endOn=addDays(addMonths(visitOn,3),state.reserveDays??DEFAULT_RESERVE_DAYS);
  const note='受診時の相談用の目安です。使用中の残期間は推定で、実測残量ではありません。未受取の処方は手持ちに含めません。';
  if(estimate.days===null)return{quantity:null,conservativeQuantity:null,remainingAtVisit:null,required:null,endOn,shortageBeforeVisit:false,note:'履歴不足のため計算できません。'+note};
  const count=(days:number,conservative:boolean)=>{
    const schedule=openingSchedule(med,state.bottles,today,days,endOn).dates;
    const before=schedule.filter(d=>d<visitOn).length; const stock=stockFor(state,med.id);
    const remaining=Math.max(0,stock-before);
    const required=conservative?openingSchedule(med,[],visitOn,days,endOn).dates.length:schedule.filter(d=>d>=visitOn).length;
    return {quantity:Math.max(0,required-remaining),remaining,required,short:before>stock};
  };
  const usual=count(estimate.days,false);const conservative=count(estimate.fastDays!,true);
  return{quantity:usual.quantity,conservativeQuantity:Math.max(usual.quantity,conservative.quantity),remainingAtVisit:usual.remaining,required:usual.required,endOn,shortageBeforeVisit:usual.short||conservative.short,note};
}
