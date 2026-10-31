import { addDays, addMonths, differenceDays, validDate } from './dates.ts';
import { estimateDuration, openingSchedule, type Estimate } from './forecast.ts';
import { activeBottles, stockFor, type Medication, type State } from './model.ts';

export type RecentEstimate=Estimate & {weights:number[]};
export type ConsultationOptions={nextVisitOn:string;followingVisitOn:string;reserveDays:number};
export type PlannedOpening={date:string;medicationId:string;quantity:number;stockCovered:number;uncovered:number};
export type Consultation={quantity:number|null;conservativeQuantity:number|null;required:number|null;beforeVisit:number|null;remainingAtVisit:number|null;shortfallBeforeVisit:number|null;endOn:string};
export type MedicationPlan={medication:Medication;estimate:RecentEstimate;stock:number;overdue:boolean;missingActive:boolean;consultation:Consultation|null};

/** Keep the established actual-duration / parallel-interval rules, then weight recent evidence. */
export function recentEstimate(med:Medication,state:State):RecentEstimate {
  const base=estimateDuration(med,state.bottles);
  // Actual durations are returned newest first; opening intervals are oldest first.
  const samples=(base.source==='actual'?[...base.samples].reverse():base.samples).slice(-3);
  const weights=samples.map((_,i)=>i+1);
  const total=weights.reduce((n,w)=>n+w,0);
  const days=total?Math.max(1,Math.round(samples.reduce((n,d,i)=>n+d*weights[i],0)/total)):null;
  return {...base,days,samples,weights,fastDays:samples.length?Math.min(...samples):null,slowDays:samples.length?Math.max(...samples):null,
    confidence:samples.length<3?'low':'reference'};
}

export function validConsultation(today:string,options:ConsultationOptions):boolean {
  const {nextVisitOn,followingVisitOn,reserveDays}=options;
  return validDate(today)&&validDate(nextVisitOn)&&validDate(followingVisitOn)&&nextVisitOn>=today&&followingVisitOn>nextVisitOn
    &&differenceDays(today,nextVisitOn)<=730&&differenceDays(today,followingVisitOn)<=1000
    &&Number.isInteger(reserveDays)&&reserveDays>=0&&reserveDays<=90;
}

function consultation(state:State,med:Medication,today:string,estimate:RecentEstimate,options:ConsultationOptions):Consultation {
  const endOn=addDays(options.followingVisitOn,options.reserveDays);
  const empty:Consultation={quantity:null,conservativeQuantity:null,required:null,beforeVisit:null,remainingAtVisit:null,shortfallBeforeVisit:null,endOn};
  if(estimate.days===null)return empty;
  const stock=stockFor(state,med.id);
  const count=(days:number,conservative:boolean)=>{
    const dates=openingSchedule(med,state.bottles,today,days,endOn).dates;
    const before=dates.filter(d=>d<options.nextVisitOn).length;
    const remaining=Math.max(0,stock-before);
    const required=conservative?openingSchedule(med,[],options.nextVisitOn,days,endOn).dates.length:dates.filter(d=>d>=options.nextVisitOn).length;
    return {before,remaining,required,quantity:Math.max(0,required-remaining),shortfall:Math.max(0,before-stock)};
  };
  const usual=count(estimate.days,false);
  const fast=count(estimate.fastDays!,true);
  return {quantity:usual.quantity,conservativeQuantity:Math.max(usual.quantity,fast.quantity),required:usual.required,beforeVisit:usual.before,
    remainingAtVisit:usual.remaining,shortfallBeforeVisit:Math.max(usual.shortfall,fast.shortfall),endOn};
}

/** Derived only from the current snapshot. Predictions are never saved as bottle records. */
export function sixMonthOpeningPlan(state:State,today:string,options?:ConsultationOptions):{until:string;medications:MedicationPlan[];openings:PlannedOpening[]} {
  if(!validDate(today))throw new Error('日付を確認してください。');
  if(options&&!validConsultation(today,options))throw new Error('診察日・予備日数を確認してください。');
  const until=addMonths(today,6);
  const openings:PlannedOpening[]=[];
  const medications=state.medications.map(medication=>{
    const estimate=recentEstimate(medication,state);
    const stock=stockFor(state,medication.id);
    const schedule=estimate.days===null?null:openingSchedule(medication,state.bottles,today,estimate.days,until);
    let used=0;
    for(const date of schedule?.dates??[]){
      const covered=used<stock?1:0;
      const previous=openings.at(-1);
      if(previous?.date===date&&previous.medicationId===medication.id){previous.quantity++;previous.stockCovered+=covered;previous.uncovered+=1-covered;}
      else openings.push({date,medicationId:medication.id,quantity:1,stockCovered:covered,uncovered:1-covered});
      used++;
    }
    return {medication,estimate,stock,overdue:schedule?.overdue??false,missingActive:activeBottles(state,medication.id).length<medication.parallel,
      consultation:options?consultation(state,medication,today,estimate,options):null};
  });
  openings.sort((a,b)=>a.date.localeCompare(b.date)||a.medicationId.localeCompare(b.medicationId));
  return {until,medications,openings};
}
