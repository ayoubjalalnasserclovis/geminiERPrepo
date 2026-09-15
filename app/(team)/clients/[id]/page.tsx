import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { BackLink } from '@/components/ui/back-link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { Button } from '@/components/ui/button';
import { InviteClientButton, ResendInviteButton } from '@/components/clients/invite-client-button';
import { createAdminClient } from '@/lib/supabase/admin';
import { RequiredDocsChecklist } from '@/components/documents/required-docs-checklist';
import { formatPhase, formatDate } from '@/lib/utils/format';
import { requireRole } from '@/lib/auth/require';

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','developer','commercial','finance','marketing','assistante']);
  const supabase = createClient();
  const { data: client } = await supabase
    .from('clients').select('*').eq('id', params.id).is('deleted_at', null).single();

  if (!client) notFound();

  // CEO 2026-08-19 (session D) : statut du lien d'invitation portail.
  // Lit le compte auth (admin) : invité le X / jamais connecté / dernière
  // connexion. Défensif — un échec de lecture ne casse pas la fiche.
  let inviteStatus: { invitedAt: string | null; lastSignInAt: string | null } | null = null;
  if (client.profile_id) {
    try {
      const admin = createAdminClient();
      const { data: userRes } = await admin.auth.admin.getUserById(client.profile_id);
      if (userRes?.user) {
        inviteStatus = {
          invitedAt: userRes.user.created_at ?? null,
          lastSignInAt: userRes.user.last_sign_in_at ?? null,
        };
      }
    } catch (e) {
      console.warn('[client-detail] lecture statut invitation échec', e);
    }
  }
  const neverConnected = !!client.profile_id && !!inviteStatus && !inviteStatus.lastSignInAt;

  const { data: projects } = await supabase
    .from('projects')
    .select('id, reference, current_phase, status, created_at')
    .eq('client_id', params.id)
    .is('deleted_at', null);

  // Récupère tous les documents liés aux projets de ce client
  const projectIds = (projects ?? []).map(p => p.id);
  const { data: clientDocs } = projectIds.length > 0
    ? await supabase
        .from('documents')
        .select('id, type, created_at, status')
        .in('project_id', projectIds)
        .is('deleted_at', null)
    : { data: [] };

  return (
    <div className="space-y-6">
      <BackLink href="/clients" label="Retour aux clients" />
      <PageHeader
        title={client.full_name}
        description={`${client.email}${client.nationality ? ' · ' + client.nationality : ''}`}
        action={
          <div className="flex gap-2">
            {!client.profile_id && <InviteClientButton clientId={client.id} />}
            {/* CEO 2026-08-19 (session D) : invité mais jamais connecté → renvoi possible */}
            {neverConnected && <ResendInviteButton clientId={client.id} />}
            <Link href={`/clients/${client.id}/edit`}><Button variant="secondary">Modifier</Button></Link>
          </div>
        }
      />

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Identité</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Téléphone" value={client.phone} />
              <Row label="Nationalité" value={client.nationality} />
              <Row label="Procuration" value={client.has_procuration ? 'Oui' + (client.procuration_received ? ' (reçue)' : '') : 'Non'} />
              <Row label="Mode signature" value={client.signature_mode === 'distance' ? 'À distance' : client.signature_mode === 'presentiel' ? 'Présentiel' : '—'} />
              <Row label="Portail" value={
                !client.profile_id
                  ? <Badge>Non invité</Badge>
                  : neverConnected
                    ? <span className="inline-flex items-center gap-2 flex-wrap">
                        <Badge variant="warning">Invité — jamais connecté</Badge>
                        {inviteStatus?.invitedAt && (
                          <span className="text-xs text-stoniz-gray-500">lien envoyé le {formatDate(inviteStatus.invitedAt)}, probablement expiré</span>
                        )}
                      </span>
                    : <span className="inline-flex items-center gap-2 flex-wrap">
                        <Badge variant="success">Actif</Badge>
                        {inviteStatus?.lastSignInAt && (
                          <span className="text-xs text-stoniz-gray-500">dernière connexion le {formatDate(inviteStatus.lastSignInAt)}</span>
                        )}
                      </span>
              } />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cahier des charges</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Budget" value={client.budget_min || client.budget_max ? <span><Money amount={client.budget_min} /> — <Money amount={client.budget_max} /></span> : '—'} />
              <Row label="Épargne" value={client.available_savings != null ? <Money amount={client.available_savings} /> : '—'} />
              <Row label="Crédit" value={client.credit_type === 'yes' ? 'Oui' : client.credit_type === 'no' ? 'Non' : client.credit_type === 'islamic' ? 'Islamique' : '—'} />
            </dl>
            {client.specificities && (
              <div className="mt-4 pt-4 border-t">
                <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Spécificités</div>
                <div className="text-sm whitespace-pre-wrap">{client.specificities}</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <RequiredDocsChecklist
        docs={clientDocs ?? []}
        showStoniz={false}
        showClient={true}
        uploadHint={projectIds.length > 0 ? {
          href: `/projects/${projectIds[0]}/documents`,
          label: 'Uploader un document pour ce client',
        } : undefined}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Projets ({projects?.length ?? 0})</CardTitle>
            <Link href={`/projects/new?client_id=${client.id}`}>
              <Button size="sm">+ Nouveau projet</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {!projects || projects.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500">Aucun projet</p>
          ) : (
            <ul className="space-y-2">
              {projects.map(p => (
                <li key={p.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.reference}</Link>
                  <div className="flex gap-2">
                    <Badge variant={p.current_phase as any}>{formatPhase(p.current_phase)}</Badge>
                    <Badge>{p.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-stoniz-gray-500">{label}</dt>
      <dd className="font-medium text-right">{value || '—'}</dd>
    </div>
  );
}
