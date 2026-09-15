import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/require';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatPhase, formatDate } from '@/lib/utils/format';
import { redirect } from 'next/navigation';
import { getPendingPvsForClient } from '@/lib/reception/get-pending-pvs-for-client';
import { PvPendingAlert } from '@/components/client/pv-pending-alert';

export default async function ClientHomePage() {
  const user = await getSessionUser();
  if (!user) return null;

  const supabase = createClient();
  const [{ data: projects }, pendingPvs] = await Promise.all([
    supabase.from('projects')
      .select(`
        id, reference, current_phase, status, created_at,
        property:properties(name, quartier)
      `)
      .order('created_at', { ascending: false }),
    getPendingPvsForClient(),
  ]);

  // 1 seul projet → redirect direct (l'alerte PV sera vue sur la fiche projet)
  if (projects && projects.length === 1) {
    redirect(`/client/projects/${projects[0].id}`);
  }

  return (
    <div>
      <p className="eyebrow mb-2">Espace investisseur</p>
      <h1 className="font-display text-4xl mb-2">Mes <mark>projets</mark></h1>
      <p className="text-grey-text mb-8">
        Bienvenue{user.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}.
      </p>

      {/* Alerte persistante : PVs de réception à signer (multi-projets) */}
      <PvPendingAlert pvs={pendingPvs} variant="dashboard" />

      {!projects || projects.length === 0 ? (
        <EmptyState
          title="Aucun projet pour le moment"
          description="Votre conseiller Stoniz finalisera bientôt l'onboarding de votre projet."
        />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {projects.map((p: any) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle>{p.property?.name ?? 'Votre projet'}</CardTitle>
                {p.property?.quartier && (
                  <div className="text-sm text-stoniz-gray-500">{p.property.quartier}</div>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <Badge variant={p.current_phase as any}>{formatPhase(p.current_phase)}</Badge>
                  <Link href={`/client/projects/${p.id}`}>
                    <Button size="sm">Ouvrir →</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
