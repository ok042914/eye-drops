import type { Command } from './inventory.ts';
import type { InitialMedication } from './model.ts';

export const DB_API_VERSION=1;
export const DB_LIMITS={medications:20,initialHistoryPerMedication:500,payloadBytes:131072,historyPageSize:100} as const;
export type MutationArgs={action:string;payload:Record<string,unknown>;operation_id:string;expected_revision:number};
function request(action:string,payload:Record<string,unknown>,operationId:string,revision:number):MutationArgs {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)||!Number.isSafeInteger(revision)||revision<0)throw new Error('操作ID・revisionを確認してください。');
  // Match JSON transport: omit undefined optional keys; server compares full JSONB payload.
  const clean=JSON.parse(JSON.stringify(payload)) as Record<string,unknown>;
  if(new TextEncoder().encode(JSON.stringify(clean)).length>DB_LIMITS.payloadBytes)throw new Error('操作の入力が上限を超えています。');
  return{action,payload:clean,operation_id:operationId,expected_revision:revision};
}
/** Serialization only. No SDK, credentials, fetch or live database connection. */
export function mutationArgs(command:Command,operationId:string,revision:number):MutationArgs {
  const {action,...payload}=command;return request(action,payload,operationId,revision);
}
export function initializationArgs(items:InitialMedication[],nextVisitOn:string|null,operationId:string,revision=0):MutationArgs {
  if(!items.length||items.length>DB_LIMITS.medications||items.some(i=>i.historicalDates.length>DB_LIMITS.initialHistoryPerMedication))throw new Error('初期登録件数の上限を確認してください。');
  return request('initialize',{items,nextVisitOn},operationId,revision);
}
export type OperationStatus={status:'committed';operationId:string;completedRevision:number}|{status:'unknown';operationId:string};
/** unknown means not yet observable, never permission to issue a fresh operation ID automatically. */
export function operationDecision(status:OperationStatus):'refresh'|'keep_pending' {
  return status.status==='committed'?'refresh':'keep_pending';
}
