import { useEffect, useState } from 'react'
import { ArrowLeft, Copy, Check, RefreshCw, Save, Trash2, Plus, Eraser } from 'lucide-react'
import type { AppSettings } from '@shared/types/settings'
import type { SystemLogEntry } from '@shared/types/dashboard'
import type { UserAccount } from '@shared/types/user-account'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'

interface Props {
  onBack: () => void
  embedded?: boolean
}

type Tab = 'event' | 'users' | 'print' | 'colors' | 'network' | 'logs'

interface LocalNetworkInfo {
  addresses: Array<{ address: string; iface: string }>
  preferredAddress: string | null
  port: number
}

/**
 * Panneau d'administration — événement, impression, couleurs, réseau, journal.
 */
export function AdminPage({ onBack, embedded = false }: Props) {
  const [tab, setTab] = useState<Tab>('event')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [logs, setLogs] = useState<SystemLogEntry[]>([])
  const [users, setUsers] = useState<UserAccount[]>([])
  const [newUsername, setNewUsername] = useState('')
  const [network, setNetwork] = useState<LocalNetworkInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteMode, setDeleteMode] = useState<'keep' | 'delete'>('keep')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function loadNetwork(): Promise<void> {
    const n = await window.judovac.getLocalNetworkInfo()
    if (n.ok) setNetwork(n.data)
  }

  async function loadUsers(): Promise<void> {
    const u = await window.judovac.listUsers()
    if (u.ok) setUsers(u.data.items)
  }

  async function loadLogs(): Promise<void> {
    const l = await window.judovac.getLogs(80)
    if (l.ok) setLogs(l.data.items)
  }

  useEffect(() => {
    void (async () => {
      const [s, l, u] = await Promise.all([
        window.judovac.getSettings(),
        window.judovac.getLogs(80),
        window.judovac.listUsers()
      ])
      if (s.ok) setSettings(s.data)
      else setError(s.error)
      if (l.ok) setLogs(l.data.items)
      if (u.ok) setUsers(u.data.items)
      await loadNetwork()
    })()
  }, [])

  async function save(): Promise<void> {
    if (!settings) return
    setBusy(true)
    setError(null)
    const res = await window.judovac.setSettings(settings)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSettings(res.data)
    setMessage('Paramètres enregistrés.')
  }

  async function createUser(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    const res = await window.judovac.createUser(newUsername)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setNewUsername('')
    setMessage(`Compte « ${res.data.username} » créé.`)
    await loadUsers()
  }

  async function removeUser(username: string): Promise<void> {
    setDeleteError(null)
    setDeleteMode('keep')
    setDeleteTarget(username)
  }

  async function confirmDeleteUser(): Promise<void> {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError(null)
    setMessage(null)
    const res = await window.judovac.deleteJudokaCreator(deleteTarget, deleteMode === 'keep')
    setDeleteBusy(false)
    if (!res.ok) {
      setDeleteError(res.error)
      return
    }
    const detail =
      deleteMode === 'keep'
        ? `${res.data.reassigned} judoka(s) réattribué(s) au Serveur`
        : `${res.data.deleted} judoka(s) supprimé(s)`
    setMessage(`Compte « ${deleteTarget} » supprimé — ${detail}.`)
    setDeleteTarget(null)
    await loadUsers()
  }

  async function clearLogs(): Promise<void> {
    if (!window.confirm('Effacer tout l’historique du journal ?')) return
    setBusy(true)
    setError(null)
    const res = await window.judovac.clearLogs()
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMessage('Journal effacé.')
    await loadLogs()
  }

  async function copyText(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(value)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('Impossible de copier dans le presse-papiers.')
    }
  }

  if (!settings) {
    return (
      <AppShell embedded={embedded} title="Configuration">
        <p className="text-sm text-muted-foreground">{error ?? 'Chargement…'}</p>
      </AppShell>
    )
  }

  const displayPort = settings.network.serverPort || network?.port || 3847
  const preferred = network?.preferredAddress

  return (
    <AppShell
      embedded={embedded}
      title="Configuration"
      subtitle="Événement · Utilisateurs · Impression · Couleurs · Réseau · Journal"
      actions={
        !embedded ? (
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto max-w-4xl space-y-6 animate-fade-in">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['event', 'Événement'],
              ['users', 'Utilisateurs'],
              ['print', 'Impression'],
              ['colors', 'Couleurs'],
              ['network', 'Réseau'],
              ['logs', 'Journal']
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              type="button"
              variant={tab === id ? 'accent' : 'outline'}
              size="sm"
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>

        {tab === 'event' && (
          <section className="grid gap-4 rounded-xl border bg-white/75 p-5 sm:grid-cols-2">
            <Field label="Nom de l'événement">
              <Input
                value={settings.event.name}
                onChange={(e) =>
                  setSettings({ ...settings, event: { ...settings.event, name: e.target.value } })
                }
              />
            </Field>
            <Field label="Type">
              <select
                className="flex h-10 w-full rounded-md border border-input bg-white/80 px-3 text-sm"
                value={settings.event.type}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    event: {
                      ...settings.event,
                      type: e.target.value as AppSettings['event']['type']
                    }
                  })
                }
              >
                <option value="competition">Compétition</option>
                <option value="exam">Examen</option>
                <option value="stage">Stage</option>
                <option value="other">Autre</option>
              </select>
            </Field>
            <Field label="Lieu">
              <Input
                value={settings.event.location}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    event: { ...settings.event, location: e.target.value }
                  })
                }
              />
            </Field>
            <Field label="Organisateur">
              <Input
                value={settings.event.organizer}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    event: { ...settings.event, organizer: e.target.value }
                  })
                }
              />
            </Field>
            <Field label="Date début">
              <Input
                type="date"
                value={settings.event.startDate}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    event: { ...settings.event, startDate: e.target.value }
                  })
                }
              />
            </Field>
            <Field label="Date fin">
              <Input
                type="date"
                value={settings.event.endDate}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    event: { ...settings.event, endDate: e.target.value }
                  })
                }
              />
            </Field>
          </section>
        )}

        {tab === 'users' && (
          <section className="space-y-4 rounded-xl border bg-white/75 p-5">
            <p className="text-sm text-muted-foreground">
              Créez les identifiants Client ici. Chaque Client se connecte avec cet identifiant pour
              se déconnecter / reconnecter et retrouver ses judokas.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                className="max-w-xs"
                placeholder="Nouvel identifiant (ex. Antoine)"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void createUser()
                  }
                }}
              />
              <Button
                type="button"
                variant="accent"
                disabled={busy || !newUsername.trim()}
                onClick={() => void createUser()}
              >
                <Plus className="h-4 w-4" />
                Créer le compte
              </Button>
            </div>
            <ul className="max-h-80 space-y-2 overflow-auto text-sm">
              {users.length === 0 && (
                <li className="text-muted-foreground">Aucun compte Client pour l’instant.</li>
              )}
              {users.map((user) => (
                <li
                  key={user.id}
                  className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0"
                >
                  <div>
                    <p className="font-medium text-judo-navy">{user.username}</p>
                    <p className="text-xs text-muted-foreground">
                      Créé le {new Date(user.createdAt).toLocaleString('fr-FR')}
                      {user.active ? '' : ' · inactif'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    onClick={() => void removeUser(user.username)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Supprimer
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'print' && (
          <section className="grid gap-4 rounded-xl border bg-white/75 p-5 sm:grid-cols-2">
            <Field label="Imprimante par défaut (nom exact)">
              <Input
                value={settings.print.defaultPrinter}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    print: { ...settings.print, defaultPrinter: e.target.value }
                  })
                }
                placeholder="Laisser vide = dialogue système"
              />
            </Field>
            <Field label="Copies">
              <Input
                type="number"
                min={1}
                max={10}
                value={settings.print.copies}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    print: { ...settings.print, copies: Number(e.target.value) || 1 }
                  })
                }
              />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={settings.print.silent}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    print: { ...settings.print, silent: e.target.checked }
                  })
                }
              />
              Impression silencieuse (sans dialogue)
            </label>
          </section>
        )}

        {tab === 'colors' && (
          <section className="grid gap-4 rounded-xl border bg-white/75 p-5 sm:grid-cols-2">
            <Field label="Couleur primaire">
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.ui.primaryColor}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      ui: { ...settings.ui, primaryColor: e.target.value }
                    })
                  }
                />
                <Input
                  value={settings.ui.primaryColor}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      ui: { ...settings.ui, primaryColor: e.target.value }
                    })
                  }
                />
              </div>
            </Field>
            <Field label="Couleur accent">
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings.ui.accentColor}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      ui: { ...settings.ui, accentColor: e.target.value }
                    })
                  }
                />
                <Input
                  value={settings.ui.accentColor}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      ui: { ...settings.ui, accentColor: e.target.value }
                    })
                  }
                />
              </div>
            </Field>
          </section>
        )}

        {tab === 'network' && (
          <section className="space-y-5 rounded-xl border bg-white/75 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-judo-navy">Adresse IP du serveur</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Communiquez cette adresse aux postes clients pour qu’ils se connectent.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadNetwork()}
              >
                <RefreshCw className="h-4 w-4" />
                Actualiser
              </Button>
            </div>

            <div className="rounded-lg border border-judo-navy/15 bg-judo-navy/[0.04] p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                IP à noter pour les clients
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="font-mono text-3xl font-semibold tracking-tight text-judo-navy">
                  {preferred ?? 'Non détectée'}
                </p>
                {preferred && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyText(preferred)}
                  >
                    {copied === preferred ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copied === preferred ? 'Copiée' : 'Copier'}
                  </Button>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Port : <span className="font-mono text-foreground">{displayPort}</span>
                {preferred && (
                  <>
                    {' '}
                    · Connexion client :{' '}
                    <span className="font-mono text-foreground">
                      {preferred}:{displayPort}
                    </span>
                  </>
                )}
              </p>
              {preferred && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 px-0"
                  onClick={() => void copyText(`${preferred}:${displayPort}`)}
                >
                  {copied === `${preferred}:${displayPort}` ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  Copier IP:port
                </Button>
              )}
            </div>

            {network && network.addresses.length > 1 && (
              <div>
                <p className="mb-2 text-sm font-medium text-judo-navy">
                  Autres adresses détectées
                </p>
                <ul className="space-y-2 text-sm">
                  {network.addresses
                    .filter((a) => a.address !== preferred)
                    .map((a) => (
                      <li
                        key={`${a.iface}-${a.address}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white/80 px-3 py-2"
                      >
                        <span>
                          <span className="font-mono">{a.address}</span>
                          <span className="ml-2 text-muted-foreground">({a.iface})</span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void copyText(a.address)}
                        >
                          {copied === a.address ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {!network?.addresses.length && (
              <p className="text-sm text-amber-800">
                Aucune adresse IPv4 LAN détectée. Vérifiez que le poste est connecté au réseau
                local, puis actualisez.
              </p>
            )}

            <Field label="Port réseau serveur">
              <Input
                type="number"
                value={settings.network.serverPort}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    network: { ...settings.network, serverPort: Number(e.target.value) || 3847 }
                  })
                }
              />
            </Field>
          </section>
        )}

        {tab === 'logs' && (
          <section className="space-y-4 rounded-xl border bg-white/75 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-judo-navy">Journal système</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || logs.length === 0}
                onClick={() => void clearLogs()}
              >
                <Eraser className="h-4 w-4" />
                Effacer
              </Button>
            </div>
            <ul className="max-h-[28rem] space-y-2 overflow-auto text-sm">
              {logs.length === 0 && (
                <li className="text-muted-foreground">Aucune entrée journal.</li>
              )}
              {logs.map((log) => (
                <li key={log.id} className="border-b border-border/50 pb-2 last:border-0">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-judo-navy">
                      [{log.level}] {log.action}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{log.message}</p>
                  {(log.actor || log.workstation) && (
                    <p className="text-xs text-muted-foreground">
                      {log.actor}
                      {log.workstation ? ` @ ${log.workstation}` : ''}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab !== 'logs' && tab !== 'users' && (
          <Button variant="accent" size="lg" disabled={busy} onClick={() => void save()}>
            <Save className="h-4 w-4" />
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-emerald-700">{message}</p>}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-user-title"
            className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
          >
            <h3 id="delete-user-title" className="text-lg font-semibold text-judo-navy">
              Supprimer « {deleteTarget} » ?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Choisissez le sort des judokas enregistrés par cet utilisateur client.
            </p>

            <div className="mt-4 space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
                <input
                  type="radio"
                  name="delete-mode"
                  className="mt-1"
                  checked={deleteMode === 'keep'}
                  onChange={() => setDeleteMode('keep')}
                />
                <span className="text-sm">
                  <span className="font-medium text-judo-navy">Garder les judokas</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Les judokas restent et seront attribués au Serveur.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-destructive/30 p-3 hover:bg-destructive/5">
                <input
                  type="radio"
                  name="delete-mode"
                  className="mt-1"
                  checked={deleteMode === 'delete'}
                  onChange={() => setDeleteMode('delete')}
                />
                <span className="text-sm">
                  <span className="font-medium text-destructive">
                    Supprimer l’utilisateur et ses judokas
                  </span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Tous les judokas de {deleteTarget} seront définitivement effacés.
                  </span>
                </span>
              </label>
            </div>

            {deleteError && <p className="mt-3 text-sm text-destructive">{deleteError}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="accent"
                disabled={deleteBusy}
                onClick={() => void confirmDeleteUser()}
              >
                {deleteBusy ? 'Suppression…' : 'Valider'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
