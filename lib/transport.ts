/** Phase 3 adapter boundary: no Supabase URL, key, or live client exists in Phase 2. */
export type AuthCapabilities = { emailOtp: boolean; passkey: 'not_implemented' | 'verified' };
export const localCapabilities: AuthCapabilities = { emailOtp: false, passkey: 'not_implemented' };
export function errorMessage(code:string,message:string):string {
  if(code==='PT409'||message==='EYE_CONFLICT')return '別の端末で更新されました。最新データを読み直してください。';
  if(code==='42501')return 'このアカウントには利用許可がありません。';
  return '処理を確認できませんでした。入力を保持し、結果を確認してください。';
}
/** Reads only. Finite retries; never wraps a write. Dependencies injected for tests. */
export async function readWithBackoff<T>(read:()=>Promise<T>,isTransient:(error:unknown)=>boolean,sleep:(ms:number)=>Promise<void>,signal?:AbortSignal):Promise<T> {
  for(let attempt=0;;attempt++) {
    signal?.throwIfAborted();
    try{return await read();}catch(error){if(attempt>=2||!isTransient(error))throw error;await sleep(1000*2**attempt);}
  }
}
