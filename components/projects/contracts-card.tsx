'use client';

import { useState, useTransition } from 'react';
import { Droplet, Zap, Wifi, Lock, KeyRound, Pencil, Save } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { updatePropertyInfrastructureAction } from '@/app/(team)/projects/actions';

/**
 * Carte "Infrastructure & accès du bien" sur la fiche projet.
 *
 * Regroupe tous les attributs du bien physique partagés par les suites
 * Propria : contrats utilités (eau / élec / internet) + WiFi + serrure
 * principale. Une seule box internet, un seul code de porte, partagés
 * par toutes les suites quand le bien est divisé.
 *
 * Les contrats sont obligatoires pour passer en phase Mise en location.
 */
export function ContractsCard({
  projectId,
  waterContractNumber,
  electricityContractNumber,
  internetContractNumber,
  wifiSsid,
  wifiPassword,
  lockCode,
  smartLock,
  currentPhase,
}: {
  projectId: string;
  waterContractNumber: string | null;
  electricityContractNumber: string | null;
  internetContractNumber: string | null;
  wifiSsid: string | null;
  wifiPassword: string | null;
  lockCode: string | null;
  smartLock: boolean | null;
  currentPhase: string;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [water, setWater] = useState(waterContractNumber ?? '');
  const [elec, setElec] = useState(electricityContractNumber ?? '');
  const [internet, setInternet] = useState(internetContractNumber ?? '');
  const [ssid, setSsid] = useState(wifiSsid ?? '');
  const [wifiPwd, setWifiPwd] = useState(wifiPassword ?? '');
  const [lock, setLock] = useState(lockCode ?? '');
  const [smart, setSmart] = useState<boolean>(!!smartLock);

  const phaseOrder = ['onboarding','sourcing','design','travaux','livraison','mise_en_location','termine'];
  const currentIdx = phaseOrder.indexOf(currentPhase);
  const blocksNext = currentIdx === phaseOrder.indexOf('livraison');
  const isOverdue = currentIdx > phaseOrder.indexOf('livraison');

  function save() {
    setError(null);
    start(async () => {
      const r = await updatePropertyInfrastructureAction(projectId, {
        water_contract: water || null,
        electricity_contract: elec || null,
        internet_contract: internet || null,
        wifi_ssid: ssid || null,
        wifi_password: wifiPwd || null,
        lock_code: lock || null,
        smart_lock: smart,
      });
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setEditing(false);
    });
  }

  function cancel() {
    setWater(waterContractNumber ?? '');
    setElec(electricityContractNumber ?? '');
    setInternet(internetContractNumber ?? '');
    setSsid(wifiSsid ?? '');
    setWifiPwd(wifiPassword ?? '');
    setLock(lockCode ?? '');
    setSmart(!!smartLock);
    setEditing(false);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Infrastructure & accès du bien</CardTitle>
          {editing ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={cancel} disabled={pending}>Annuler</Button>
              <Button size="sm" onClick={save} disabled={pending}>
                <Save className="w-4 h-4" /> {pending ? '…' : 'Enregistrer'}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="w-4 h-4" /> Modifier
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

        {/* Sous-bloc : Contrats utilités (compteurs) */}
        <div className="mb-4">
          <h3 className="text-xs uppercase tracking-wide text-stoniz-gray-500 mb-2">Contrats utilités</h3>
          <dl className="space-y-3 text-sm">
            <Row icon={<Droplet className="w-4 h-4 text-blue-600" />}
              label="N° contrat eau"
              value={waterContractNumber}
              editing={editing}
              inputValue={water}
              onChange={setWater}
              blocksNext={blocksNext && !waterContractNumber}
              isOverdue={isOverdue && !waterContractNumber}
            />
            <Row icon={<Zap className="w-4 h-4 text-yellow-600" />}
              label="N° contrat électricité"
              value={electricityContractNumber}
              editing={editing}
              inputValue={elec}
              onChange={setElec}
              blocksNext={blocksNext && !electricityContractNumber}
              isOverdue={isOverdue && !electricityContractNumber}
            />
            <Row icon={<Wifi className="w-4 h-4 text-purple-600" />}
              label="N° contrat internet"
              value={internetContractNumber}
              editing={editing}
              inputValue={internet}
              onChange={setInternet}
              blocksNext={false}
              isOverdue={false}
              optional
            />
          </dl>
        </div>

        {/* Sous-bloc : Accès partagés (porte principale + WiFi) */}
        <div className="pt-4 border-t border-stoniz-gray-100">
          <h3 className="text-xs uppercase tracking-wide text-stoniz-gray-500 mb-2">
            Accès partagés <span className="normal-case text-stoniz-gray-400">— commun à toutes les suites</span>
          </h3>
          <dl className="space-y-3 text-sm">
            <Row icon={<Wifi className="w-4 h-4 text-stoniz-gray-600" />}
              label="SSID WiFi"
              value={wifiSsid}
              editing={editing}
              inputValue={ssid}
              onChange={setSsid}
              blocksNext={false}
              isOverdue={false}
              optional
            />
            <Row icon={<Wifi className="w-4 h-4 text-stoniz-gray-600" />}
              label="Mot de passe WiFi"
              value={wifiPassword}
              editing={editing}
              inputValue={wifiPwd}
              onChange={setWifiPwd}
              blocksNext={false}
              isOverdue={false}
              optional
            />
            <Row icon={<Lock className="w-4 h-4 text-stoniz-gray-600" />}
              label="Code serrure (porte principale)"
              value={lockCode}
              editing={editing}
              inputValue={lock}
              onChange={setLock}
              blocksNext={false}
              isOverdue={false}
              optional
            />
            <div className="flex justify-between items-center gap-3">
              <dt className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-stoniz-gray-600" />
                <span className="text-stoniz-gray-600">Serrure électronique principale</span>
              </dt>
              <dd>
                {editing ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={smart} onChange={e => setSmart(e.target.checked)} />
                    <span>Oui</span>
                  </label>
                ) : (
                  <span className={smartLock ? 'font-medium' : 'text-stoniz-gray-400 text-xs'}>
                    {smartLock ? 'Oui' : 'Non'}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        <p className="text-xs text-stoniz-gray-500 mt-4 pt-3 border-t">
          Les <strong>3 contrats</strong> (eau, électricité, assurance) + les n° de contrats eau et
          électricité sont obligatoires pour passer en Mise en location. Uploader les PDF dans la
          section Documents. Les attributs WiFi et serrure principale sont partagés par toutes les
          suites Propria d'un même bien — les clés physiques par suite se gèrent côté Propria.
        </p>
      </CardContent>
    </Card>
  );
}

function Row({
  icon, label, value, editing, inputValue, onChange, blocksNext, isOverdue, optional,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  editing: boolean;
  inputValue: string;
  onChange: (v: string) => void;
  blocksNext: boolean;
  isOverdue: boolean;
  optional?: boolean;
}) {
  return (
    <div className="flex justify-between items-center gap-3">
      <dt className="flex items-center gap-2 flex-wrap">
        {icon}
        <span className="text-stoniz-gray-600">{label}</span>
        {optional && <span className="text-xs text-stoniz-gray-400">(optionnel)</span>}
        {isOverdue && <Badge variant="error">⚠ À renseigner</Badge>}
        {blocksNext && <Badge variant="warning">requis pour Mise en location</Badge>}
      </dt>
      <dd>
        {editing ? (
          <Input value={inputValue} onChange={e => onChange(e.target.value)}
            placeholder="—" className="w-48" />
        ) : (
          <span className={value ? 'font-medium' : 'text-stoniz-gray-400 text-xs'}>
            {value ?? 'Non renseigné'}
          </span>
        )}
      </dd>
    </div>
  );
}
