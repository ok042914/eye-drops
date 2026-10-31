import type { SupabaseClient } from '@supabase/supabase-js';

type AuthFailure={code?:string;status?:number};

function rateLimitMessage(error:AuthFailure):string|null {
  if(error.code==='over_email_send_rate_limit')return '認証メールの送信がSupabaseの共有上限に達しています。Lens StockとEye Dropsで送信枠を共有しています。再送を繰り返さず、1時間ほど時間を空けてからお試しください。60秒待つだけでは解除されない場合があります。';
  if(error.code==='over_request_rate_limit'||error.status===429)return '認証のリクエストが一時的に制限されています。再送を繰り返さず、時間を空けてからお試しください。';
  return null;
}

type LoginAuth=Pick<SupabaseClient['auth'],'signInWithOtp'|'verifyOtp'>;

/** Reuse an existing shared Auth account. Eye's database allowlist controls app access. */
export async function sendLoginCode(auth:LoginAuth,email:string){
  const {error}=await auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false}});
  if(error)throw new Error(rateLimitMessage(error)??(error.code==='email_address_not_authorized'?'このメールアドレスへの送信は、認証サービスのメール送信設定で許可されていません。管理者による確認が必要です。':'コードを送信できませんでした。Lens Stockに登録済みのメールアドレスと接続を確認してください。'));
}

export async function verifyLoginCode(auth:LoginAuth,email:string,token:string){
  const {error}=await auth.verifyOtp({email:email.trim(),token:token.trim(),type:'email'});
  if(error)throw new Error(rateLimitMessage(error)??'コードを確認できませんでした。最新のコードと有効期限を確認してください。');
}
