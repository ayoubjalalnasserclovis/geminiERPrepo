'use client';

import { useState, useTransition } from 'react';
import { X, Loader2, Calendar, TrendingUp, TrendingDown, Check } from 'lucide-react';
import { updateScheduledDateAction, excludeBeneficiaryFromRecurringAction } from './actions';

export type FlowItem = {
  source: 'travaux_payment' | 'achats_payment' | 'services_payment' | 'honoraires_payment' | 'travaux_encaissement' | 'achats_encaissement' | 'recurring';
  id: string;
  date: string;
  amount_mad: number;
  label: string;
  partner: string | null;
  kind: 'inflow' | 'outflow';
  editable: boolean;
  overdue?: boolean;
};

export type RecurringDetail = {
  category: string;
  total_3m: number;
  per_month: number;
  beneficiaries?: { name: string; total: number; count: number }[];
};

function fmtMad(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('fr-FR');
}

export function ProjectionDetailsDrawer({
  flows,
  recurring,
  canEdit,
}: {
  flows: FlowItem[];
  recurring: RecurringDetail[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState<null | 'inflows' | 'outflows' | 'recurring'>(null);

  // Tri : overdues en premier (les plus anciens d'abord), puis chronologique futur
  function sortFlow(a: FlowItem, b: FlowItem): number {
    if (a.overdue && !b.overdue) return -1;
    if (!a.overdue && b.overdue) return 1;
    return a.date.localeCompare(b.date);
  }
  const inflows = flows.filter((f) => f.kind === 'inflow').sort(sortFlow);
  const outflows = flows.filter((f) => f.kind === 'outflow').sort(sortFlow);
  const overdueInflows = inflows.filter((f) => f.overdue);
  const overdueOutflows = outflows.filter((f) => f.overdue);

  const totalInflow = inflows.reduce((s, f) => s + f.amount_mad, 0);
  const totalOutflow = outflows.reduce((s, f) => s + f.amount_mad, 0);
  const totalRecurring = recurring.reduce((s, r) => s + r.total_3m, 0);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setOpen('inflows')}
          className="text-left bg-white border border-emerald-200 rounded p-4 hover:bg-emerald-50 transition"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase text-emerald-700">Entrées prévues (90j)</span>
            <TrendingUp className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-2xl font-display text-emerald-700">+ {fmtMad(totalInflow)}</div>
          <div className="text-xs text-stoniz-gray-500 mt-1">
            {inflows.length} échéance{inflows.length > 1 ? 's' : ''} · clic pour détail
          </div>
          {overdueInflows.length > 0 && (
            <div className="mt-2 text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 inline-block">
              ⚠ {overdueInflows.length} en retard · {fmtMad(overdueInflows.reduce((s, i) => s + i.amount_mad, 0))}
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={() => setOpen('outflows')}
          className="text-left bg-white border border-red-200 rounded p-4 hover:bg-red-50 transition"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase text-red-700">Sorties scheduled (90j)</span>
            <TrendingDown className="w-4 h-4 text-red-700" />
          </div>
          <div className="text-2xl font-display text-red-700">− {fmtMad(totalOutflow)}</div>
          <div className="text-xs text-stoniz-gray-500 mt-1">
            {outflows.length} paiement{outflows.length > 1 ? 's' : ''} programmé{outflows.length > 1 ? 's' : ''} · clic pour détail
          </div>
          {overdueOutflows.length > 0 && (
            <div className="mt-2 text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 inline-block">
              ⚠ {overdueOutflows.length} en retard · {fmtMad(overdueOutflows.reduce((s, o) => s + o.amount_mad, 0))}
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={() => setOpen('recurring')}
          className="text-left bg-white border border-amber-200 rounded p-4 hover:bg-amber-50 transition"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase text-amber-700">Charges récurrentes (90j)</span>
            <Calendar className="w-4 h-4 text-amber-700" />
          </div>
          <div className="text-2xl font-display text-amber-700">− {fmtMad(totalRecurring)}</div>
          <div className="text-xs text-stoniz-gray-500 mt-1">
            {recurring.length} poste{recurring.length > 1 ? 's' : ''} détecté{recurring.length > 1 ? 's' : ''} · clic pour détail
          </div>
        </button>
      </div>

      {open && (
        <Drawer
          title={
            open === 'inflows' ? 'Entrées prévues (90 prochains jours)'
              : open === 'outflows' ? 'Sorties scheduled (90 prochains jours)'
                : 'Charges récurrentes — détail par poste'
          }
          subtitle={
            open === 'inflows' ? 'Échéances honoraires Stoniz non encore payées. Modifie une date pour simuler.'
              : open === 'outflows' ? 'Acomptes artisans/fournisseurs/services scheduled. Modifie une date pour simuler.'
                : 'Moyenne mensuelle estimée à partir des 3 derniers mois bancaires.'
          }
          onClose={() => setOpen(null)}
        >
          {open === 'inflows' && (
            <FlowList items={inflows} canEdit={canEdit} sign="+" />
          )}
          {open === 'outflows' && (
            <FlowList items={outflows} canEdit={canEdit} sign="−" />
          )}
          {open === 'recurring' && (
            <RecurringList items={recurring} />
          )}
        </Drawer>
      )}
    </>
  );
}

function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-stretch justify-end"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-2xl h-full overflow-y-auto p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between sticky top-0 bg-white py-2 -mx-6 px-6 border-b">
          <div>
            <h2 className="text-xl font-display">{title}</h2>
            {subtitle && <p className="text-xs text-stoniz-gray-500 mt-1">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-stoniz-gray-400 hover:text-stoniz-black">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FlowList({ items, canEdit, sign }: { items: FlowItem[]; canEdit: boolean; sign: '+' | '−' }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-stoniz-gray-500">
        Aucune ligne sur les 90 prochains jours.
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {items.map((it) => (
        <FlowRow key={`${it.source}-${it.id}`} item={it} canEdit={canEdit} sign={sign} />
      ))}
      <div className="flex justify-between items-center pt-3 border-t mt-3 text-sm font-display">
        <div>Total</div>
        <div className={sign === '+' ? 'text-emerald-700' : 'text-red-700'}>
          {sign} {fmtMad(items.reduce((s, i) => s + i.amount_mad, 0))}
        </div>
      </div>
    </div>
  );
}

function FlowRow({ item, canEdit, sign }: { item: FlowItem; canEdit: boolean; sign: '+' | '−' }) {
  const [date, setDate] = useState(item.date);
  const [savedDate, setSavedDate] = useState(item.date);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(newDate: string) {
    if (newDate === savedDate) return;
    setError(null);
    start(async () => {
      const r = await updateScheduledDateAction({
        source: item.source as any,
        id: item.id,
        new_date: newDate,
      });
      if (!r.ok) {
        setError(r.error);
        setDate(savedDate);
        return;
      }
      setSavedDate(newDate);
    });
  }

  const daysOverdue = item.overdue
    ? Math.floor((new Date().getTime() - new Date(item.date).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  return (
    <div className={`flex items-center justify-between gap-3 py-2 border-b border-stoniz-gray-100 text-sm ${item.overdue ? 'bg-red-50/50' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate flex items-center gap-2">
          {item.label}
          {item.overdue && (
            <span className="text-[10px] uppercase font-bold text-red-700 bg-red-100 border border-red-200 rounded px-1.5 py-0.5">
              ⚠ Retard {daysOverdue}j
            </span>
          )}
        </div>
        {item.partner && (
          <div className="text-xs text-stoniz-gray-500 truncate">{item.partner}</div>
        )}
        <div className="text-[10px] uppercase text-stoniz-gray-400 mt-0.5">
          {item.source.replace(/_/g, ' ')}
          {item.overdue && <span className="text-red-600"> · date initiale : {fmtDate(item.date)}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className={`font-mono ${sign === '+' ? 'text-emerald-700' : 'text-red-700'}`}>
          {sign} {fmtMad(item.amount_mad)}
        </div>
        {item.editable && canEdit ? (
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onBlur={(e) => save(e.target.value)}
              disabled={pending}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-0.5"
            />
            {pending && <Loader2 className="w-3 h-3 animate-spin text-stoniz-gray-500" />}
          </div>
        ) : (
          <div className="text-xs text-stoniz-gray-500">{fmtDate(item.date)}</div>
        )}
        {error && <div className="text-[10px] text-red-600 max-w-[180px]">{error}</div>}
      </div>
    </div>
  );
}

function RecurringList({ items }: { items: RecurringDetail[] }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-stoniz-gray-500">
        Aucune charge récurrente détectée sur les 3 derniers mois.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((r) => (
        <div key={r.category} className="border border-stoniz-gray-200 rounded p-3">
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-sm font-medium">{r.category}</div>
              <div className="text-xs text-stoniz-gray-500">
                ≈ {fmtMad(r.per_month)} / mois
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-display">{fmtMad(r.total_3m)}</div>
              <div className="text-xs text-stoniz-gray-500">3 derniers mois</div>
            </div>
          </div>
          {r.beneficiaries && r.beneficiaries.length > 0 && (
            <div className="mt-2 pt-2 border-t border-stoniz-gray-100 space-y-1">
              {r.beneficiaries.map((b) => (
                <BeneficiaryRow key={b.name} name={b.name} count={b.count} total={b.total} />
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="text-xs text-stoniz-gray-500 italic bg-stoniz-gray-50 border border-stoniz-gray-200 rounded p-3">
        💡 <strong>Tu vois un fournisseur/artisan dans cette liste ?</strong> Clique sur "Exclure" à côté de son nom :
        il sera retiré des charges récurrentes et automatiquement catégorisé comme achat ou travaux aux prochains imports bancaires.
        Les vraies charges cabinet (salaires, loyer, abonnement internet, impôts, CNSS, frais bancaires) doivent rester.
      </div>
    </div>
  );
}

const EXCLUDE_OPTIONS: { value: 'achats' | 'travaux' | 'services' | 'honoraires' | 'propria' | 'intercompany' | 'autre'; label: string }[] = [
  { value: 'achats',       label: 'Projet — achats' },
  { value: 'travaux',      label: 'Projet — travaux' },
  { value: 'services',     label: 'Projet — services (architecte, géomètre…)' },
  { value: 'honoraires',   label: 'Honoraires Stoniz' },
  { value: 'propria',      label: 'Propria conciergerie' },
  { value: 'intercompany', label: 'Intercompany (transfert entre sociétés)' },
  { value: 'autre',        label: 'Autre / Charge ponctuelle (à ne pas compter en récurrent)' },
];

function BeneficiaryRow({ name, count, total }: { name: string; count: number; total: number }) {
  const [excluded, setExcluded] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function exclude(allocType: typeof EXCLUDE_OPTIONS[number]['value']) {
    setError(null);
    start(async () => {
      const r = await excludeBeneficiaryFromRecurringAction({
        beneficiary: name,
        allocation_type: allocType,
      });
      if (!r.ok) {
        setError(r.error);
        setSelectedType('');
        return;
      }
      setExcluded(true);
    });
  }

  if (excluded) {
    return (
      <div className="flex justify-between items-center text-xs py-1 opacity-50">
        <span className="truncate line-through">{name}</span>
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <Check className="w-3 h-3" /> Exclu (refresh la page pour voir l'effet)
        </span>
      </div>
    );
  }

  return (
    <div className="flex justify-between items-center text-xs py-1 gap-2 group">
      <span className="truncate flex-1 min-w-0">
        {name} <span className="text-stoniz-gray-400">({count}×)</span>
      </span>
      <span className="font-mono text-stoniz-gray-600 whitespace-nowrap">{fmtMad(total)}</span>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1">
        {pending ? (
          <Loader2 className="w-3 h-3 animate-spin text-stoniz-gray-500" />
        ) : (
          <select
            value={selectedType}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              setSelectedType(v);
              exclude(v as any);
            }}
            title="Exclure ce bénéficiaire des charges récurrentes"
            className="text-[10px] border border-stoniz-gray-300 hover:border-red-600 rounded px-1.5 py-0.5 bg-white text-stoniz-gray-700"
          >
            <option value="">🚫 Exclure comme…</option>
            {EXCLUDE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
      </div>
      {error && <div className="text-[10px] text-red-600 ml-2">{error}</div>}
    </div>
  );
}
