import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/require';
import { OnboardingForm } from '@/components/client-onboarding/onboarding-form';

export default async function ClientOnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const supabase = createClient();

  // 1. Cherche par profile_id (cas standard)
  let { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('profile_id', user.id)
    .maybeSingle();

  // 2. Sinon, cherche par email (user invité avant que sa fiche client soit créée)
  if (!client) {
    const { data: byEmail } = await supabase
      .from('clients')
      .select('*')
      .eq('email', user.email)
      .is('profile_id', null)
      .maybeSingle();
    if (byEmail) {
      // Lie ce client au profile actuel
      await supabase.from('clients').update({ profile_id: user.id }).eq('id', byEmail.id);
      client = { ...byEmail, profile_id: user.id };
    }
  }

  // Aucune fiche client → on attend que le conseiller la crée
  if (!client) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <h1 className="font-display text-3xl mb-4">Bienvenue chez Stoniz 👋</h1>
        <p className="text-stoniz-gray-600 mb-2">
          Votre compte est bien activé, mais votre conseiller n&apos;a pas encore finalisé la création
          de votre fiche.
        </p>
        <p className="text-stoniz-gray-500 text-sm">
          Nous vous contacterons par email dès que tout est prêt.
        </p>
      </div>
    );
  }

  // Déjà complété → retour direct au portail
  if (client?.onboarding_completed_at) redirect('/client');

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-3xl mb-2">Bienvenue chez Stoniz 👋</h1>
        <p className="text-stoniz-gray-600">
          Pour commencer, prenez quelques minutes pour compléter votre profil investisseur.
          Ces informations nous permettent de vous proposer des biens adaptés à vos objectifs.
        </p>
      </div>
      <OnboardingForm client={client} userEmail={user.email} />
    </div>
  );
}
