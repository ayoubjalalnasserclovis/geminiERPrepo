'use client';
import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/browser';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border p-8 shadow-sm">
        <h1 className="font-display text-2xl mb-6">Mot de passe oublié</h1>
        {sent ? (
          <div className="space-y-4">
            <p className="text-sm text-stoniz-gray-600">Un lien de réinitialisation vient d'être envoyé à {email}.</p>
            <Link href="/login" className="block text-center text-sm underline">Retour</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <input
              type="email"
              required
              placeholder="Votre email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-md border px-3 py-2 bg-white"
            />
            {error && <div className="text-sm text-red-600">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full bg-stoniz-black text-white py-2.5 rounded-md font-medium disabled:opacity-50">
              {loading ? 'Envoi…' : 'Envoyer le lien'}
            </button>
            <Link href="/login" className="block text-center text-sm text-stoniz-gray-500 underline">Retour</Link>
          </form>
        )}
      </div>
    </div>
  );
}
