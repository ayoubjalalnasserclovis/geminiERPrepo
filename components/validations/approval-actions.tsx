'use client';

import { useState, useTransition, useRef } from 'react';
import { Check, X, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import {
  financeReviewAction,
  ceoApproveAction,
  markApprovalAsPaidAction,
} from '@/app/(team)/validations/actions';

export function ApprovalActions({
  approvalId, userRole, financeStatus, ceoStatus, isPaid,
}: {
  approvalId: string;
  userRole: string;
  financeStatus: string;
  ceoStatus: string;
  isPaid: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState<null | 'finance' | 'ceo' | 'pay'>(null);

  const canFinance = userRole === 'finance' || userRole === 'ceo';
  const canCEO = userRole === 'ceo';
  const canPay = (userRole === 'ceo' || userRole === 'finance');

  const showFinanceBtns = canFinance && financeStatus === 'pending' && !isPaid;
  const showCEOBtns = canCEO && ceoStatus === 'pending' && financeStatus !== 'rejected' && !isPaid;
  const showPayBtn = canPay && ceoStatus === 'approved' && !isPaid;

  if (isPaid) return null;
  if (!showFinanceBtns && !showCEOBtns && !showPayBtn) return null;

  function close() { setOpenModal(null); setError(null); }

  return (
    <div className="flex flex-col gap-1.5 items-end">
      {showFinanceBtns && (
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setOpenModal('finance')} disabled={pending}>
            <Check className="w-3.5 h-3.5" /> Finance OK
          </Button>
          <Button size="sm" variant="ghost" onClick={() => {
            if (!confirm('Rejeter au niveau Finance ? La demande sera marquée comme rejetée.')) return;
            setError(null);
            start(async () => {
              const notes = prompt('Raison du rejet (optionnel) :') ?? undefined;
              const r = await financeReviewAction(approvalId, 'rejected', notes);
              if (!r.ok) setError(r.error ?? 'Erreur');
            });
          }} disabled={pending} className="text-red-600">
            <X className="w-3.5 h-3.5" /> Rejeter
          </Button>
        </div>
      )}

      {showCEOBtns && (
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => setOpenModal('ceo')} disabled={pending}>
            <Check className="w-3.5 h-3.5" /> Approuver final
          </Button>
          <Button size="sm" variant="ghost" onClick={() => {
            if (!confirm('Rejeter au niveau CEO ? Cette décision est finale.')) return;
            setError(null);
            start(async () => {
              const notes = prompt('Raison du rejet (optionnel) :') ?? undefined;
              const r = await ceoApproveAction(approvalId, 'rejected', notes);
              if (!r.ok) setError(r.error ?? 'Erreur');
            });
          }} disabled={pending} className="text-red-600">
            <X className="w-3.5 h-3.5" /> Rejeter
          </Button>
        </div>
      )}

      {showPayBtn && (
        <Button size="sm" onClick={() => setOpenModal('pay')} disabled={pending}>
          <CreditCard className="w-3.5 h-3.5" /> Marquer comme payé
        </Button>
      )}

      {error && <div className="text-xs text-red-600 max-w-xs text-right">{error}</div>}

      {openModal === 'finance' && (
        <FinanceModal approvalId={approvalId} onClose={close} />
      )}
      {openModal === 'ceo' && (
        <CEOModal approvalId={approvalId} onClose={close} />
      )}
      {openModal === 'pay' && (
        <PayModal approvalId={approvalId} onClose={close} />
      )}
    </div>
  );
}

function FinanceModal({ approvalId, onClose }: { approvalId: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    start(async () => {
      const r = await financeReviewAction(approvalId, 'approved', notes);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      onClose();
    });
  }
  return (
    <Modal title="Approuver (Finance)" onClose={onClose}>
      <p className="text-sm text-stoniz-gray-600">
        Approuver cette demande pour transmission au CEO. Le CEO devra valider à son tour avant le virement.
      </p>
      <div>
        <Label>Notes (optionnel)</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <ModalFooter onClose={onClose} onSubmit={submit} pending={pending} submitLabel="Approuver pour CEO" />
    </Modal>
  );
}

function CEOModal({ approvalId, onClose }: { approvalId: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    start(async () => {
      const r = await ceoApproveAction(approvalId, 'approved', notes);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      onClose();
    });
  }
  return (
    <Modal title="Approbation finale (CEO)" onClose={onClose}>
      <p className="text-sm text-stoniz-gray-600">
        Approuver définitivement cette demande. Le virement pourra ensuite être effectué.
      </p>
      <div>
        <Label>Notes (optionnel)</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <ModalFooter onClose={onClose} onSubmit={submit} pending={pending} submitLabel="Approuver final" />
    </Modal>
  );
}

function PayModal({ approvalId, onClose }: { approvalId: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await markApprovalAsPaidAction(approvalId, fd);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      onClose();
    });
  }
  return (
    <Modal title="Marquer comme payé" onClose={onClose}>
      <form ref={formRef} onSubmit={submit} className="space-y-3">
        <p className="text-sm text-stoniz-gray-600">
          Renseignez les détails du virement effectué et joignez la preuve.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Mode</Label>
            <Input name="payment_method" placeholder="Virement, espèces…" defaultValue="Virement" />
          </div>
          <div>
            <Label>N° référence</Label>
            <Input name="payment_reference" placeholder="VRT-2026-…" />
          </div>
        </div>
        <div>
          <Label>Preuve (PDF / image, max 25 MB)</Label>
          <input type="file" name="proof_file"
            accept=".pdf,.png,.jpg,.jpeg,.webp" className="w-full text-sm py-2" />
          <p className="text-xs text-stoniz-gray-500 mt-1">
            Screenshot du virement bancaire, reçu Wise, ordre signé…
          </p>
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>Annuler</Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Marquer comme payé'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3" onClick={e => e.stopPropagation()}>
        <h2 className="font-display text-xl">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({ onClose, onSubmit, pending, submitLabel }: {
  onClose: () => void; onSubmit: () => void; pending: boolean; submitLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button variant="secondary" onClick={onClose} disabled={pending}>Annuler</Button>
      <Button onClick={onSubmit} disabled={pending}>{pending ? '…' : submitLabel}</Button>
    </div>
  );
}
