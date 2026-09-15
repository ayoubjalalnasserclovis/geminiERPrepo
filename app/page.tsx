import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/require';

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // CEO 2026-06-10 : redirection role-aware
  if (user.role === 'client') redirect('/client');
  if (user.role === 'menage') redirect('/propria/menage');
  // CEO 2026-06-10 : CEO et Propria atterrissent sur le Daily (point 14h)
  if (user.role === 'ceo' || user.role === 'propria') redirect('/propria/daily');
  redirect('/dashboard');
}
