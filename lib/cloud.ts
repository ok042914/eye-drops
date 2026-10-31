import type { Bottle, Medication, Movement, Receipt, State, Visit } from './model';
import { supabase } from './supabase';
import type { MutationArgs } from './db-contract';
type Row=Record<string,unknown>;
export class CloudError extends Error { constructor(readonly code:string,message:string){super(message);} }
export async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{
  const {data,error}=await supabase().rpc(name,args);
  if(error){
    const message=error.message;
    throw new CloudError(error.code,message==='EYE_BUSY'?'ほかの保存処理中です。少し待ってから確認してください。':error.code==='PT409'?'更新が競合しました。最新データを確認してください。':error.code==='PT403'?'このアカウントはEye Dropsに登録されていません。':error.code==='PT422'?'入力内容・在庫数を確認してください。':'通信または保存結果を確認できませんでした。');
  }
  return data as T;
}
async function history(kind:string):Promise<Row[]>{
  const rows:Row[]=[];let after_date:string|null=null;let after_id:string|null=null;
  const dateKey={bottles:'opened_on',prescriptions:'prescribed_on',visits:'visit_on',movements:'effective_on'}[kind]!;
  for(let page=0;page<100;page++){
    const data:{items:Row[];mayHaveMore:boolean}=await rpc<{items:Row[];mayHaveMore:boolean}>('eye_stock_history',{kind,page_size:100,after_date,after_id});
    rows.push(...data.items);
    if(!data.mayHaveMore)return rows;
    const last:Row=data.items.at(-1)!;after_date=String(last[dateKey]);after_id=String(last.id);
  }
  throw new Error('履歴が取得上限を超えています。データは削除していません。');
}
export async function loadState(known?:State|null):Promise<State|null>{
  if(!known)await rpc('eye_stock_enroll',{});
  const meta=await rpc<Row>('eye_stock_snapshot',{known_revision:known?.revision??null});
  if(meta.unchanged&&known)return known;
  if(!meta.initializedOn)return null;
  const [bottles,receipts,visits,movements]=await Promise.all(['bottles','prescriptions','visits','movements'].map(history));
  const check=await rpc<Row>('eye_stock_snapshot',{known_revision:meta.revision});
  if(!check.unchanged)throw new CloudError('PT409','取得中に更新されました。もう一度更新してください。');
  const meds=(meta.medications as Row[]).map(m=>({id:m.medication_id,name:m.name,volumeMl:Number(m.volume_ml),timesPerDay:m.times_per_day,parallel:m.parallel,expirationDays:m.expiration_days,expirationSource:m.expiration_source,directions:m.directions,version:m.version})) as Medication[];
  return {schemaVersion:1,revision:Number(meta.revision),initializedOn:String(meta.initializedOn),nextVisitOn:meta.nextVisitOn as string|null,medications:meds,
    bottles:bottles.map(b=>({id:b.id,medicationId:b.medication_id,openedOn:b.opened_on,origin:b.origin,status:b.status,endedOn:b.ended_on,endReason:b.end_reason,replacesId:b.replaces_id,version:b.settings_version,parallel:b.parallel,expirationDays:b.expiration_days})) as Bottle[],
    movements:movements.reverse().map(m=>({id:m.id,medicationId:m.medication_id,delta:m.delta,kind:m.kind,date:m.effective_on,referenceId:m.bottle_id??m.prescription_id??null,note:m.note,operationId:m.operation_id})) as Movement[],
    receipts:receipts.map(r=>({id:r.id,medicationId:r.medication_id,prescribedOn:r.prescribed_on,receivedOn:r.received_on??null,prescribedQuantity:r.prescribed_quantity,receivedQuantity:r.received_quantity??0,note:r.note,visitId:r.visit_id,cancelled:r.cancelled})) as Receipt[],
    visits:visits.map(v=>({id:v.id,date:v.visit_on,nextDate:v.next_visit_on,note:v.note})) as Visit[],operations:[]};
}
export async function saveCommand(request:MutationArgs){return rpc('eye_stock_mutate',request);}
