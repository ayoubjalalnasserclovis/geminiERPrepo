'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const router = useRouter();

  // Vérifie qu'on a bien une session active (sinon on ne peut pas updateUser)
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas'); return; }
    if (password.length < 10) { setError('Minimum 10 caractères'); return; }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: upErr } = await supabase.auth.updateUser({ password });
    if (upErr) {
      setLoading(false);
      setError(upErr.message);
      return;
    }

    // Récupère le rôle pour rediriger correctement
    const { data: { user } } = await supabase.auth.getUser();
    let redirect = '/';
    if (user) {
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (profile?.role === 'client') redirect = '/client';
    }
    setLoading(false);
    router.push(redirect);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-cream">
      <div className="w-full max-w-md bg-white rounded-md border border-grey-line p-8 shadow-sm">
        <h1 className="font-display text-2xl mb-2">Définissez votre mot de passe</h1>
        <p className="text-sm text-stoniz-gray-600 mb-6">
          Choisissez un mot de passe sécurisé pour finaliser la création de votre compte.
        </p>

        {hasSession === false && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-sm p-3">
            ⚠️ Aucune session active. Le lien d'invitation a peut-être expiré.{' '}
            <a href="/login" className="underline font-semibold">Réessayer la connexion</a> ou demander un nouveau lien à votre conseiller.
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <input
            type="password"
            required
            placeholder="Nouveau mot de passe (min. 10 caractères)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={hasSession === false}
            className="w-full rounded-sm border border-grey-line px-3 py-2 bg-white disabled:opacity-50"
          />
          <input
            type="password"
            required
            placeholder="Confirmation du mot de passe"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            disabled={hasSession === false}
            className="w-full rounded-sm border border-grey-line px-3 py-2 bg-white disabled:opacity-50"
          />
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button
            type="submit"
            disabled={loading || hasSession === false}
            className="w-full bg-stoniz-black text-cream py-2.5 rounded-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Mise à jour…' : 'Définir mon mot de passe'}
          </button>
        </form>
      </div>
    </div>
  );
}
