import { getSessionUser } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default async function ClientProfilePage() {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = createClient();
  const { data: client } = await supabase.from('clients')
    .select('*').eq('profile_id', user.id).single();

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Mon profil</h1>

      <Card>
        <CardHeader><CardTitle>Identité</CardTitle></CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <Row label="Nom" value={user.full_name} />
            <Row label="Email" value={user.email} />
            <Row label="Téléphone" value={client?.phone} />
            <Row label="Nationalité" value={client?.nationality} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sécurité & confidentialité</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-3">
          <p>Pour modifier votre mot de passe, contactez votre conseiller Stoniz qui vous enverra un lien sécurisé.</p>
          <p className="text-stoniz-gray-500">
            Vos données sont stockées sur des serveurs européens (Supabase EU). Vous pouvez demander
            l'export ou la suppression de vos données en écrivant à <a href="mailto:contact@stoniz.co" className="underline">contact@stoniz.co</a>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-stoniz-gray-500">{label}</dt>
      <dd className="font-medium">{value ?? '—'}</dd>
    </div>
  );
}
