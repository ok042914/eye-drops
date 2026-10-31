'use client';
import { useState, type FormEvent } from 'react';
import type { State } from '../lib/model';
import type { Command } from '../lib/inventory';
import { addMonths, displayDate, HISTORY_START, validDate } from '../lib/dates';
import OpeningPlanPanel from './opening-plan-panel';
export default function VisitsPanel({state,today,run}:{state:State;today:string;run:(c:Command)=>boolean}){
  const [date,setDate]=useState(today);const [next,setNext]=useState(addMonths(today,3));
  function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=new FormData(e.currentTarget);if(window.confirm(`受診日 ${displayDate(date)}、次回予定 ${displayDate(next)} を記録します。`))run({action:'visit',date,nextDate:next,note:String(data.get('note'))});}
  return <><div className="page-heading"><p className="eyebrow">診察の前に、手元を確認。</p><h1>通院・処方の目安</h1></div><OpeningPlanPanel key={state.nextVisitOn??"unset"} state={state} today={today}/>
    <section className="panel"><h2>通院を記録</h2><form onSubmit={submit}><div className="form-grid"><label>受診日<input type="date" min={HISTORY_START} max={today} required value={date} onChange={e=>{setDate(e.target.value);if(validDate(e.target.value))setNext(addMonths(e.target.value,3));}}/></label><label>次回受診予定日<input type="date" min={date} required value={next} onChange={e=>setNext(e.target.value)}/></label></div><p className="muted small">次回予定は受診日の3暦月後を提案し、月末に補正します。自由に変更できます。</p><label>備考<textarea name="note" maxLength={500} rows={2}/></label><button className="primary">通院記録を保存</button></form></section>
    <section className="panel"><h2>これまでの通院</h2>{!state.visits.length?<p className="empty">通院記録はまだありません。</p>:<ul className="record-list">{[...state.visits].sort((a,b)=>b.date.localeCompare(a.date)).map(v=><li key={v.id}><strong>{displayDate(v.date)} 受診</strong><p>次回予定：{displayDate(v.nextDate)}</p>{v.note&&<p>{v.note}</p>}<p className="muted small">{state.receipts.filter(r=>r.visitId===v.id&&!r.cancelled).map(r=>`${state.medications.find(m=>m.id===r.medicationId)?.name} ${r.prescribedQuantity}本`).join(' ／ ')||'処方の関連付けなし（処方・入庫画面から登録）'}</p></li>)}</ul>}</section></>;
}
