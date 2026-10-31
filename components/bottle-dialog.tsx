'use client';
import { useState, type FormEvent } from 'react';
import type { Bottle, State } from '../lib/model';
import { activeBottles, stockFor } from '../lib/model';
import type { Command } from '../lib/inventory';
import { displayDate, HISTORY_START } from '../lib/dates';
import { Dialog } from './shared';
export default function BottleDialog({state,today,medicationId,ending,onClose,run,externalError}:{state:State;today:string;medicationId:string;ending?:Bottle;onClose:()=>void;run:(c:Command)=>boolean;externalError:string}){
  const med=state.medications.find(m=>m.id===medicationId)!;const active=activeBottles(state,medicationId);
  const [date,setDate]=useState(today);const [replace,setReplace]=useState('');const [reason,setReason]=useState<'empty'|'discarded'>('empty');const [error,setError]=useState('');
  function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();
    if(!ending&&active.length>=med.parallel&&!replace){setError('終了するボトルを1本選んでください。');return;}
    const action:Command=ending?{action:'end',bottleId:ending.id,date,reason}:{action:'open',medicationId,date,replaceId:replace||undefined,replacementReason:replace?reason:undefined};
    if(!window.confirm(ending?`${med.name}のボトル ${ending.id.slice(-6)} を${reason==='empty'?'使い切り':'廃棄'}として記録します。未開封在庫は変わりません。`:`${med.name}を1本開封します。未開封在庫：${stockFor(state,med.id)} → ${stockFor(state,med.id)-1}本。${replace?'選択したボトルの使用も終了します。':''}`))return;
    if(run(action))onClose();
  }
  return <Dialog title={ending?'ボトルの使用終了':'1本を開封する'} onClose={onClose}><form onSubmit={submit}><p className="drug-label">{med.name} · {med.volumeMl}mL</p>{ending&&<p>対象：ボトル {ending.id.slice(-6)} / {displayDate(ending.openedOn)}開封</p>}<label>{ending?'使用終了日':'開封日'}<input required type="date" min={ending?.openedOn??state.initializedOn??HISTORY_START} max={today} value={date} onChange={e=>setDate(e.target.value)}/></label>
    {!ending&&active.length>0&&<label>終了して切り替えるボトル{active.length>=med.parallel?'（必須）':'（任意）'}<select value={replace} required={active.length>=med.parallel} onChange={e=>setReplace(e.target.value)}><option value="">切り替えず追加</option>{active.map(b=><option key={b.id} value={b.id}>{displayDate(b.openedOn)}開封 · {b.id.slice(-6)}</option>)}</select></label>}
    {(ending||replace)&&<label>終了理由<select value={reason} onChange={e=>setReason(e.target.value as 'empty'|'discarded')}><option value="empty">使い切り</option><option value="discarded">廃棄</option></select></label>}
    <p className="hint">{ending?'選んだ1本だけを終了します。開封済みの実物を未開封在庫に戻す操作ではありません。':'1回の操作で1本だけ登録します。過去の使用済み履歴は「開封履歴」から追加してください。'}</p>{(error||externalError)&&<p className="message error" role="alert">{error||externalError}</p>}<button className="primary wide">{ending?'この1本を終了する':'確認して1本を開封'}</button></form></Dialog>;
}
