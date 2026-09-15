'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Save, X } from 'lucide-react';
import { updateClientContactAction } from '../actions';

export function ClientContactEditor({
  clientId,
  fullName,
  email,
  phone,
  isPlaceholder,
}: {
  clientId: string | undefined;
  fullName: string;
  email: string;
  phone: string | null;
  isPlaceholder: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [emailValue, setEmailValue] = useState(isPlaceholder ? '' : email);
  const [phoneValue, setPhoneValue] = useState(phone ?? '');
  const router = useRouter();

  if (!clientId) {
    return <div className="text-sm text-stoniz-gray-500 italic">Pas de client lié</div>;
  }

  function save() {
    setError(null);
    const fd = new FormData();
    fd.append('client_id', clientId!);
    fd.append('email', emailValue);
    fd.append('phone', phoneValue);
    start(async () => {
      const r = await updateClientContactAction(fd);
      if (!r.ok) {
        setError(r.error ?? 'Erreur');
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="text-sm space-y-2">
      <div>
        <div className="text-xs text-stoniz-gray-500">Nom complet</div>
        <div className="font-medium">{fullName}</div>
      </div>

      {!editing ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-stoniz-gray-500">Email</div>
              {isPlaceholder ? (
                <div className="text-amber-700 italic">à compléter ({email.split('@')[0]})</div>
              ) : (
                <div className="font-medium break-all">{email}</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-stoniz-gray-500">Téléphone</div>
              <div className={phone ? 'font-medium' : 'text-stoniz-gray-400 italic'}>
                {phone ?? 'non renseigné'}
              </div>
            </div>
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-stoniz-black hover:underline flex items-center gap-1 flex-shrink-0"
            >
              <Pencil className="w-3 h-3" />
              Modifier
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-2 pt-2 border-t border-stoniz-gray-100">
          <div>
            <label className="text-xs text-stoniz-gray-500">Email réel du client</label>
            <input
              type="email"
              value={emailValue}
              onChange={e => setEmailValue(e.target.value)}
              placeholder="client@example.com"
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-500">Téléphone</label>
            <input
              value={phoneValue}
              onChange={e => setPhoneValue(e.target.value)}
              placeholder="+212 ..."
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm mt-1"
            />
          </div>
          {error && <div className="text-xs text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={pending || !emailValue.includes('@')}
              className="bg-stoniz-black text-white px-3 py-1.5 rounded text-xs hover:bg-stoniz-gray-800 disabled:opacity-40 flex items-center gap-1"
            >
              <Save className="w-3 h-3" />
              {pending ? '…' : 'Enregistrer'}
            </button>
            <button
              onClick={() => { setEditing(false); setError(null); }}
              disabled={pending}
              className="border border-stoniz-gray-300 text-stoniz-gray-700 px-3 py-1.5 rounded text-xs hover:bg-stoniz-gray-50 flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
