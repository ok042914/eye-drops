import type { MetadataRoute } from 'next';
export default function manifest():MetadataRoute.Manifest {
  return {name:'Eye Drops',short_name:'Eye Drops',lang:'ja',start_url:'/',scope:'/',display:'standalone',background_color:'#F2FAF9',theme_color:'#087E79',icons:[{src:'/icon-192',sizes:'192x192',type:'image/png'},{src:'/icon-512',sizes:'512x512',type:'image/png'},{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'maskable'}]};
}
