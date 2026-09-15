'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Handshake, Sparkles } from 'lucide-react';
import { updateProjectServiceTypeAction } from '@/app/(team)/projects/[id]/edit-metadata-actions';

/**
 * Badge affichant le type de service (Clé en main / Coaching) d'un projet,
 * cliquable pour basculer (CEO + chef_projet). CEO 2026-08-17.
 *
 * Visible pour tous les rôles staff. Seul CEO + chef_projet peut ouvrir le
 * menu de bascule (les autres voient juste le badge lecture seule).
 */
export type ServiceType = 'cle_en_main' | 'coaching';

const META: Record<ServiceType, { label: string; className: string; icon: typeof Handshake; hint: string }> = {
  cle_en_main: {
    label: 'Clé en main',
    className: 'bg-stoniz-black text-cream border-stoniz-black',
    icon: Sparkles,
    hint: '5 milestones honoraires · 21 000 €',
  },
  coaching: {
    label: 'Coaching',
    className: 'bg-amber-50 text-amber-800 border-amber-300',
    icon: Handshake,
    hint: '5 000 € forfaitaire · exclu des prévisions honoraires',
  },
};

export function ServiceTypeBadge({
  projectId,
  serviceType,
  userRole,
}: {
  projectId: string;
  serviceType: ServiceType;
  userRole: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canEdit = userRole === 'ceo' || userRole === 'chef_projet';
  const current = META[serviceType];
  const Icon = current.icon;

  function switchTo(next: ServiceType) {
    setError(null);
    start(async () => {
      const r = await updateProjectServiceTypeAction({
        project_id: projectId,
        service_type: next,
      });
      if (!r.ok) { setError(r.error); return; }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => canEdit && setOpen(o => !o)}
        disabled={!canEdit || pending}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${current.className} ${canEdit ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
        title={canEdit ? `${current.hint} · cliquer pour changer` : current.hint}
      >
        <Icon className="w-3 h-3" />
        {current.label}
      </button>

      {open && canEdit && (
        <div
          className="absolute z-40 mt-1 right-0 min-w-[240px] bg-white border border-stoniz-gray-200 rounded-lg shadow-lg p-2"
          onMouseLeave={() => !pending && setOpen(false)}
        >
          <p className="text-[10px] uppercase tracking-wider text-stoniz-gray-500 px-2 pt-1 pb-2">
            Type de service
          </p>
          {(Object.keys(META) as ServiceType[]).map(k => {
            const m = META[k];
            const K = m.icon;
            const isCurrent = k === serviceType;
            return (
              <button
                key={k}
                type="button"
                disabled={pending || isCurrent}
                onClick={() => switchTo(k)}
                className={`w-full text-left px-2 py-2 rounded-md flex items-start gap-2 text-sm ${isCurrent ? 'bg-stoniz-gray-100 opacity-60' : 'hover:bg-stoniz-gray-50'}`}
              >
                <K className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  <span className="block font-medium">{m.label}</span>
                  <span className="block text-[11px] text-stoniz-gray-500">{m.hint}</span>
                </span>
                {isCurrent && <span className="ml-auto text-[10px] text-stoniz-gray-500 self-center">✓ actuel</span>}
              </button>
            );
          })}
          {error && (
            <div className="mt-1 text-[11px] text-red-700 bg-red-50 rounded p-2">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
