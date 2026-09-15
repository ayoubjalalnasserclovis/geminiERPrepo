'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'Identifiants invalides' : error.message);
      setLoading(false);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full rounded-md border px-3 py-2 bg-white focus:outline-none focus:border-stoniz-black"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Mot de passe</label>
        <input
          type="password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full rounded-md border px-3 py-2 bg-white focus:outline-none focus:border-stoniz-black"
        />
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-stoniz-black text-white py-2.5 rounded-md font-medium hover:opacity-85 disabled:opacity-50"
      >
        {loading ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  );
}
