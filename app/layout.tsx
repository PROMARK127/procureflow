import './styles.css';
import type { ReactNode } from 'react';
export const metadata = { title: 'ProcureFlow | 購買管理', description: '東都テクノロジー株式会社の購買業務デモ' };
export default function Layout({children}:{children:ReactNode}) {
  return <html lang="ja"><body>{children}</body></html>;
}