'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let client:SupabaseClient|undefined;
export function cloudConfigured(){return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);}
export function supabase(){
  if(!cloudConfigured())throw new Error('クラウド接続の設定が完了していません。');
  return client??=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{
    auth:{storageKey:'eye-drops-auth-v1',persistSession:true,detectSessionInUrl:false,experimental:{passkey:true}},
    global:{fetch:(url,options)=>fetch(url,{...options,cache:'no-store',signal:options?.signal??AbortSignal.timeout(15000)})}
  });
}
export function passkeyConfigured(){return process.env.NEXT_PUBLIC_PASSKEY_ENABLED==='true';}
