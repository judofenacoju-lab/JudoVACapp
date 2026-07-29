import { useEffect, useState } from 'react'
import { ArrowLeft, Copy, Check, RefreshCw, Save, Trash2, Plus, Eraser } from 'lucide-react'
import type { AppSettings } from '@shared/types/settings'
import { createDefaultCategoryAgeRanges } from '@shared/types/settings'
import type { SystemLogEntry } from '@shared/types/dashboard'
import type { CreatedUserAccount, UserAccount } from '@shared/types/user-account'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'

interface Props {
  onBack: () => void
  embedded?: boolean
}

type Tab = 'event' | 'users' | 'categories' | 'print' | 'colors' | 'network' | 'logs'

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
  const [newPassword, setNewPassword] = useState('')
  const [createdCredentials, setCreatedCredentials] = useState<CreatedUserAccount | null>(null)
  const [network, setNetwork] = useState<LocalNetworkInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [resetTarget, setResetTarget] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

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
    const categories = (settings.categories ?? []).map((r) => ({
      name: r.name.trim(),
      minAge: Number(r.minAge),
      maxAge: Number(r.maxAge)
    }))
    for (const r of categories) {
      if (!r.name) {
        setBusy(false)
        setError('Chaque catégorie doit avoir un nom.')
        setTab('categories')
        return
      }
      if (!Number.isFinite(r.minAge) || !Number.isFinite(r.maxAge) || r.minAge > r.maxAge) {
        setBusy(false)
        setError(`Tranche invalide pour « ${r.name} » (âge min ≤ âge max).`)
        setTab('categories')
        return
      }
    }
    const payload = { ...settings, categories }
    const res = await window.judovac.setSettings(payload)
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
    try {
      const username = newUsername.trim()
      if (!username) {
        setError("Indiquez un nom d'utilisateur (ex. orient).")
        return
      }
      if (newPassword.trim() && newPassword.trim().length < 6) {
        setError('Le mot de passe doit contenir au moins 6 caractères.')
        return
      }
      const res = await window.judovac.createUser(
        username,
        undefined,
        newPassword.trim() || undefined
      )
      if (!res.ok) {
        setError(res.error)
        return
      }
      setNewUsername('')
      setNewPassword('')
      setCreatedCredentials(res.data)
      setMessage(`Compte « ${res.data.username} » créé.`)
      await loadUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Création impossible')
    } finally {
      setBusy(false)
    }
  }

  function isProtectedAdmin(user: UserAccount): boolean {
    return (
      user.role === 'admin' ||
      user.username.toLowerCase() === 'admin' ||
      user.username === 'Serveur'
    )
  }

  function openResetPassword(username: string): void {
    setResetError(null)
    setResetPassword('')
    setResetTarget(username)
  }

  async function confirmResetPassword(): Promise<void> {
    if (!resetTarget) return
    setResetBusy(true)
    setResetError(null)
    setMessage(null)
    const pwd = resetPassword.trim()
    if (pwd && pwd.length < 6) {
      setResetBusy(false)
      setResetError('Le mot de passe doit contenir au moins 6 caractères.')
      return
    }
    const res = await window.judovac.resetUserPassword(resetTarget, pwd || undefined)
    setResetBusy(false)
    if (!res.ok) {
      setResetError(res.error)
      return
    }
    setResetTarget(null)
    setResetPassword('')
    setCreatedCredentials(res.data)
    setMessage(`Mot de passe de « ${res.data.username} » réinitialisé.`)
    await loadUsers()
  }

  async function removeUser(username: string): Promise<void> {
    setDeleteError(null)
    setDeleteTarget(username)
  }

  async function confirmDeleteUser(): Promise<void> {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError(null)
    setMessage(null)
    const res = await window.judovac.deleteUser(deleteTarget)
    setDeleteBusy(false)
    if (!res.ok) {
      setDeleteError(res.error)
      return
    }
    setMessage(`Compte « ${deleteTarget} » supprimé.`)
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
      subtitle="Événement · Utilisateurs · Catégorie · Impression · Couleurs · Réseau · Journal"
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
              ['categories', 'Catégorie'],
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
              Saisissez un nom (ex. <span className="font-mono text-foreground">orient</span>) — l’email
              de connexion sera{' '}
              <span className="font-mono text-foreground">orient@mail.com</span>. Vous pouvez aussi
              coller directement l’email.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom d'utilisateur">
                <Input
                  placeholder="Ex. orient"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void createUser()
                    }
                  }}
                />
              </Field>
              <Field label="Mot de passe (min. 6 caractères)">
                <Input
                  type="text"
                  placeholder="Laisser vide = généré automatiquement"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void createUser()
                    }
                  }}
                />
              </Field>
            </div>
            <div>
              <Button
                type="button"
                variant="accent"
                disabled={busy || !newUsername.trim()}
                onClick={() => void createUser()}
              >
                <Plus className="h-4 w-4" />
                {busy ? 'Création…' : 'Créer le compte'}
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {message && <p className="text-sm text-emerald-700">{message}</p>}
            <ul className="max-h-80 space-y-2 overflow-auto text-sm">
              {users.length === 0 && (
                <li className="text-muted-foreground">Aucun compte pour l’instant.</li>
              )}
              {users.map((user) => (
                <li
                  key={user.id}
                  className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0"
                >
                  <div>
                    <p className="font-medium text-judo-navy">
                      {user.username}
                      {isProtectedAdmin(user) && (
                        <span className="ml-2 rounded bg-judo-navy/10 px-1.5 py-0.5 text-xs font-normal text-judo-navy">
                          Admin
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {user.email ?? `${user.username.toLowerCase()}@mail.com`}
                      {' · '}
                      Créé le {new Date(user.createdAt).toLocaleString('fr-FR')}
                      {user.active ? '' : ' · inactif'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Réinitialiser le mot de passe"
                      disabled={busy || resetBusy}
                      onClick={() => openResetPassword(user.username)}
                    >
                      <RefreshCw className="h-4 w-4 text-judo-navy" />
                      <span className="sr-only">Réinitialiser</span>
                    </Button>
                    {!isProtectedAdmin(user) ? (
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
                    ) : (
                      <span className="px-2 text-xs text-muted-foreground">Non supprimable</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'categories' && (
          <section className="space-y-4 rounded-xl border bg-white/75 p-5">
            <p className="text-sm text-muted-foreground">
              Définissez les tranches d’âge utilisées pour attribuer automatiquement la catégorie
              d’un judoka (formulaire et liste).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">Catégorie</th>
                    <th className="px-2 py-2 w-28">Âge min</th>
                    <th className="px-2 py-2 w-28">Âge max</th>
                    <th className="px-2 py-2 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {(settings.categories ?? createDefaultCategoryAgeRanges()).map((row, index) => (
                    <tr key={`${row.name}-${index}`} className="border-b last:border-0">
                      <td className="px-2 py-2">
                        <Input
                          value={row.name}
                          onChange={(e) => {
                            const categories = [...(settings.categories ?? [])]
                            categories[index] = { ...categories[index], name: e.target.value }
                            setSettings({ ...settings, categories })
                          }}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={120}
                          value={row.minAge}
                          onChange={(e) => {
                            const categories = [...(settings.categories ?? [])]
                            categories[index] = {
                              ...categories[index],
                              minAge: Number(e.target.value)
                            }
                            setSettings({ ...settings, categories })
                          }}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={120}
                          value={row.maxAge}
                          onChange={(e) => {
                            const categories = [...(settings.categories ?? [])]
                            categories[index] = {
                              ...categories[index],
                              maxAge: Number(e.target.value)
                            }
                            setSettings({ ...settings, categories })
                          }}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="Supprimer"
                          disabled={(settings.categories ?? []).length <= 1}
                          onClick={() => {
                            const categories = (settings.categories ?? []).filter((_, i) => i !== index)
                            setSettings({ ...settings, categories })
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSettings({
                    ...settings,
                    categories: [
                      ...(settings.categories ?? []),
                      { name: 'Nouvelle', minAge: 0, maxAge: 0 }
                    ]
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Ajouter une catégorie
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSettings({
                    ...settings,
                    categories: createDefaultCategoryAgeRanges()
                  })
                }
              >
                <RefreshCw className="h-4 w-4" />
                Restaurer les défauts
              </Button>
            </div>
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

      {createdCredentials && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="credentials-title"
            className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
          >
            <h3 id="credentials-title" className="text-lg font-semibold text-judo-navy">
              {createdCredentials.password && message?.includes('réinitialisé')
                ? 'Mot de passe réinitialisé'
                : 'Compte créé — identifiants de connexion'}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Communiquez ces informations à{' '}
              <strong>{createdCredentials.username}</strong> pour qu’il puisse se connecter.
            </p>
            <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="font-mono font-medium">{createdCredentials.email}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyText(createdCredentials.email)}
                >
                  {copied === createdCredentials.email ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">Mot de passe</p>
                  <p className="font-mono font-medium">{createdCredentials.password}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyText(createdCredentials.password)}
                >
                  {copied === createdCredentials.password ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button type="button" variant="accent" onClick={() => setCreatedCredentials(null)}>
                Fermer
              </Button>
            </div>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-title"
            className="w-full max-w-md rounded-xl border bg-white p-6 shadow-xl"
          >
            <h3 id="reset-password-title" className="text-lg font-semibold text-judo-navy">
              Réinitialiser le mot de passe
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Compte <strong>{resetTarget}</strong> — le mot de passe actuel n’est pas demandé.
              Laissez vide pour générer un mot de passe automatiquement.
            </p>
            <div className="mt-4">
              <Label htmlFor="reset-new-password">Nouveau mot de passe</Label>
              <Input
                id="reset-new-password"
                type="text"
                className="mt-1"
                placeholder="Min. 6 caractères ou vide = généré"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void confirmResetPassword()
                  }
                }}
              />
            </div>
            {resetError && <p className="mt-3 text-sm text-destructive">{resetError}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={resetBusy}
                onClick={() => {
                  setResetTarget(null)
                  setResetPassword('')
                  setResetError(null)
                }}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="accent"
                disabled={resetBusy}
                onClick={() => void confirmResetPassword()}
              >
                {resetBusy ? 'Réinitialisation…' : 'Réinitialiser'}
              </Button>
            </div>
          </div>
        </div>
      )}

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
              Ce compte ne pourra plus se connecter. Les judokas enregistrés par cet utilisateur
              restent dans la base.
            </p>

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
                {deleteBusy ? 'Suppression…' : 'Supprimer'}
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
