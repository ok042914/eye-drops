import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Eye Drops | 目薬の在庫と開封記録',
  description: '目薬の在庫・開封履歴・受診の相談用目安を管理する個人用アプリ。',
  appleWebApp: { capable: true, title: 'Eye Drops', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/apple-icon' },
  robots: { index: false, follow: false }
};
export const viewport: Viewport = { width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#087E79' };
export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="ja"><body>{children}</body></html>;
}
