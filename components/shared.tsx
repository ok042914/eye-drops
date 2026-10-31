'use client';
import { useEffect, useRef } from 'react';
import type { Medication } from '../lib/model';
import { displayDate } from '../lib/dates';
export function DateValue({value}:{value:string|null}){return value?<time dateTime={value}>{displayDate(value)}</time>:<>履歴不足</>;}
export function Dialog({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current;if(d&&!d.open)d.showModal();return()=>{d?.close();};},[]);
  return <dialog ref={ref} onCancel={event=>{event.preventDefault();onClose();}} aria-labelledby="dialog-title"><div className="dialog-top"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="閉じる">×</button></div>{children}</dialog>;
}
export function MedicationFields({med,onChange}:{med:Medication;onChange:(m:Medication)=>void}){
  const set=(value:Partial<Medication>)=>onChange({...med,...value});
  return <div className="form-grid">
    <label>薬剤名<input required maxLength={60} value={med.name} onChange={e=>set({name:e.target.value})}/></label>
    <label>容量（mL）<input type="number" required min="0.1" max="100" step="0.1" value={med.volumeMl} onChange={e=>set({volumeMl:Number(e.target.value)})}/></label>
    <label>1日の使用回数<input type="number" required min="1" max="12" value={med.timesPerDay} onChange={e=>set({timesPerDay:Number(e.target.value)})}/></label>
    <label>同時に使用する本数<input type="number" required min="1" max="4" value={med.parallel} onChange={e=>set({parallel:Number(e.target.value)})}/></label>
    <label className="full">用法の表示<input maxLength={120} value={med.directions} onChange={e=>set({directions:e.target.value})}/></label>
    <label>開封後の期限（任意・日）<input type="number" min="1" max="365" placeholder="未設定" value={med.expirationDays??''} onChange={e=>set({expirationDays:e.target.value===''?null:Number(e.target.value)})}/></label>
    <label>期限の根拠・確認先<input required={med.expirationDays!==null} maxLength={300} placeholder="薬剤情報・薬剤師への確認など" value={med.expirationSource} onChange={e=>set({expirationSource:e.target.value})}/></label>
  </div>;
}
