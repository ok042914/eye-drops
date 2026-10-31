'use client';
import { useState, type FormEvent } from 'react';
import type { State } from '../lib/model';
import type { Command } from '../lib/inventory';
import { displayDate, HISTORY_START } from '../lib/dates';
const statuses={in_use:'使用中',finished:'使い切り',discarded:'廃棄',historical:'過去履歴',cancelled:'取消済み'};
export default function HistoryPanel({state,today,run}:{state:State;today:string;run:(c:Command)=>boolean}){
  const [filter,setFilter]=useState('all');const [editing,setEditing]=useState<string|null>(null);const [editDate,setEditDate]=useState('');const [limit,setLimit]=useState(30);
  function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=new FormData(e.currentTarget);const med=String(data.get('medication'));const date=String(data.get('date'));
    if(window.confirm('過去の開封履歴を1本追加します。現在の未開封在庫は変わりません。')&&run({action:'import',medicationId:med,date}))e.currentTarget.reset();}
  const entries=state.bottles.filter(b=>filter==='all'||b.medicationId===filter).sort((a,b)=>b.openedOn.localeCompare(a.openedOn)||b.id.localeCompare(a.id));
  return <><div className="page-heading"><p className="eyebrow">1本ずつ、振り返る。</p><h1>開封履歴</h1></div><details className="panel"><summary>＋ 過去の開封履歴を追加</summary><p className="hint">使用済みの過去履歴専用です。在庫の減算はありません。現在使用中の初期登録は初期設定で行います。</p><form onSubmit={submit}><div className="form-grid"><label>薬剤<select name="medication">{state.medications.map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label><label>開封日<input type="date" name="date" min={HISTORY_START} max={today} required/></label></div><button className="primary">1本分を追加（在庫変更なし）</button></form></details>
    <section className="panel"><label className="filter">薬剤で絞り込み<select value={filter} onChange={e=>{setFilter(e.target.value);setLimit(30);}}><option value="all">すべて</option>{state.medications.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    {entries.length===0?<p className="empty">まだ開封履歴はありません。</p>:<ul className="record-list">{entries.slice(0,limit).map(b=>{
      const med=state.medications.find(m=>m.id===b.medicationId)!;const linked=b.replacesId||b.endedOn||state.bottles.some(other=>other.replacesId===b.id&&other.status!=='cancelled');
      return <li key={b.id} className={b.status==='cancelled'?'cancelled':''}><div className="record-top"><div><strong>{med.name}</strong><span>{displayDate(b.openedOn)} 開封 · {b.id.slice(-6)}</span></div><span className="badge">{statuses[b.status]}</span></div><p className="muted small">{b.origin==='normal'?'通常開封：在庫 −1本':b.origin==='initial'?'初期使用中登録：在庫変更なし':'過去履歴登録：在庫変更なし'}{b.endedOn&&` ／ ${displayDate(b.endedOn)} ${b.endReason==='empty'?'使い切り':'廃棄'}`}</p>
      {b.status!=='cancelled'&&<div className="actions"><button className="text-button" onClick={()=>{setEditing(b.id);setEditDate(b.openedOn);}}>日付を訂正</button><button className="text-button danger-text" disabled={!!linked} title={linked?'使用終了・切替に関連するため単独取消できません':undefined} onClick={()=>{if(window.confirm(b.origin==='normal'?'実際には開封していなかった記録だけ取り消せます。未開封在庫を1本戻します。実物が開封済みなら使用終了→廃棄を選んでください。':'記録を取り消します。未開封在庫は変わりません。'))run({action:'cancel_opening',bottleId:b.id});}}>記録を取消{b.origin==='normal'?'（在庫＋1）':''}</button></div>}
      {editing===b.id&&<form onSubmit={e=>{e.preventDefault();if(run({action:'edit_opening',bottleId:b.id,date:editDate}))setEditing(null);}}><label>訂正後の開封日（本数変更なし）<input type="date" required min={b.origin==='normal'?state.initializedOn:HISTORY_START} max={b.endedOn??today} value={editDate} onChange={e=>setEditDate(e.target.value)}/></label><div className="actions"><button className="primary">訂正を保存</button><button type="button" className="secondary" onClick={()=>setEditing(null)}>やめる</button></div></form>}
      {linked&&b.status!=='cancelled'&&<small className="muted">使用終了・切替に関連する記録の単独取消はできません。</small>}</li>;
    })}</ul>}{entries.length>limit&&<button className="secondary" onClick={()=>setLimit(n=>n+30)}>さらに30件表示</button>}</section></>;
}
