'use client';

import { useState } from 'react';
import { Wifi, KeyRound, Eye, EyeOff } from 'lucide-react';
import { Card } from '@/components/ui/card';

/**
 * Encart "Accès Propria" sur la fiche projet (et fiche bien).
 * Affiche WiFi SSID + mot de passe + code serrure principale.
 * Mot de passe et code serrure masqués par défaut, révélables au clic.
 */
export function PropriaAccessCard({
  wifiSsid,
  wifiPassword,
  lockCode,
}: {
  wifiSsid?: string | null;
  wifiPassword?: string | null;
  lockCode?: string | null;
}) {
  const [showPwd, setShowPwd] = useState(false);
  const [showLock, setShowLock] = useState(false);

  if (!wifiSsid && !wifiPassword && !lockCode) return null;

  return (
    <Card>
      <div className="px-5 py-4 border-b border-stoniz-gray-100">
        <h3 className="font-medium">Accès Propria</h3>
        <p className="text-xs text-stoniz-gray-500 mt-0.5">
          Informations partagées entre tous les lots du bien
        </p>
      </div>
      <div className="px-5 py-4 grid md:grid-cols-3 gap-4 text-sm">
        {wifiSsid && (
          <div>
            <div className="flex items-center gap-1.5 text-xs text-stoniz-gray-500 mb-1">
              <Wifi className="w-3 h-3" /> Réseau WiFi
            </div>
            <div className="font-mono text-sm">{wifiSsid}</div>
          </div>
        )}
        {wifiPassword && (
          <div>
            <div className="flex items-center gap-1.5 text-xs text-stoniz-gray-500 mb-1 justify-between">
              <span className="flex items-center gap-1.5">
                <Wifi className="w-3 h-3" /> Mot de passe WiFi
              </span>
              <button
                onClick={() => setShowPwd((s) => !s)}
                className="text-stoniz-gray-400 hover:text-stoniz-gray-700"
              >
                {showPwd ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <div className="font-mono text-sm">{showPwd ? wifiPassword : '••••••••'}</div>
          </div>
        )}
        {lockCode && (
          <div>
            <div className="flex items-center gap-1.5 text-xs text-stoniz-gray-500 mb-1 justify-between">
              <span className="flex items-center gap-1.5">
                <KeyRound className="w-3 h-3" /> Code serrure
              </span>
              <button
                onClick={() => setShowLock((s) => !s)}
                className="text-stoniz-gray-400 hover:text-stoniz-gray-700"
              >
                {showLock ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <div className="font-mono text-sm">{showLock ? lockCode : '••••••••'}</div>
          </div>
        )}
      </div>
    </Card>
  );
}
