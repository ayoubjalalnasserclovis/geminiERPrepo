import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PropriaBienForm } from '@/components/propria/propria-bien-form';
import { createPropriaPropertyAction } from '../actions';

export default async function NewPropriaBienPage() {
  await requireRole(['ceo','developer','assistante','propria']);
  const supabase = createClient();

  const { data: providers } = await supabase
    .from('propria_providers')
    .select('id, name, function')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name');

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria/biens" className="hover:text-stoniz-black">Biens gérés</Link> · Nouveau
        </div>
        <h1 className="text-3xl font-display">Ajouter un bien externe</h1>
        <p className="text-sm text-stoniz-gray-600 mt-2">
          Pour un bien qui n'est pas issu d'un projet Stoniz Clé en Main.
          Toutes les informations marquées <span className="text-red-600">*</span> sont obligatoires.
        </p>
      </div>

      <PropriaBienForm
        providers={providers ?? []}
        action={createPropriaPropertyAction}
        submitLabel="Créer le bien"
      />
    </div>
  );
}
