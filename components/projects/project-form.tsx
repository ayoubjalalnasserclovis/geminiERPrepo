'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { createProjectAction } from '@/app/(team)/projects/actions';

export function ProjectForm({
  clients, chefs, defaultClientId,
}: {
  clients: { id: string; full_name: string }[];
  chefs: { id: string; full_name: string }[];
  defaultClientId?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true); setError(null);
    const form = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(form.entries());
    if (data.travaux_budget) data.travaux_budget = Number(data.travaux_budget);

    const res = await createProjectAction(data);
    setLoading(false);
    if (!res.ok) { setError(res.error ?? 'Erreur'); return; }
    router.push(`/projects/${(res as any).id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card className="space-y-4">
        <div>
          <Label>Client *</Label>
          <select name="client_id" defaultValue={defaultClientId ?? ''} required
            className="w-full h-10 rounded-md border bg-white px-3 text-sm">
            <option value="">— Sélectionner —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>
        <div>
          <Label>Chef de projet</Label>
          <select name="assigned_chef_projet"
            className="w-full h-10 rounded-md border bg-white px-3 text-sm">
            <option value="">—</option>
            {chefs.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>
        <div className="text-xs text-stoniz-gray-500 pt-2 border-t">
          💡 La date d'onboarding est posée automatiquement à la création du projet
          (corrigeable ensuite dans « Dates clés »). Le budget travaux estimé se renseigne
          sur la fiche du <strong>bien</strong>, pas sur le projet. L'épargne du client se
          renseigne sur la fiche client.
        </div>
      </Card>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Annuler</Button>
        <Button type="submit" disabled={loading}>{loading ? 'Création…' : 'Créer le projet'}</Button>
      </div>
    </form>
  );
}
