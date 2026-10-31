import type { SupabaseClient } from '@supabase/supabase-js';

type LoginAuth=Pick<SupabaseClient['auth'],'signInWithOtp'|'verifyOtp'>;

/** Reuse an existing shared Auth account. Eye's database allowlist controls app access. */
export async function sendLoginCode(auth:LoginAuth,email:string){
  const {error}=await auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false}});
  if(error)throw new Error('コードを送信できませんでした。Lens Stockに登録済みのメールアドレスと接続を確認してください。');
}

export async function verifyLoginCode(auth:LoginAuth,email:string,token:string){
  const {error}=await auth.verifyOtp({email:email.trim(),token:token.trim(),type:'email'});
  if(error)throw new Error('コードを確認できませんでした。最新のコードと有効期限を確認してください。');
}
