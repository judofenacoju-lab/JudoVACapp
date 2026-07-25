import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, Save } from 'lucide-react'
import type { Judoka } from '@shared/types/judoka'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppShell } from '@/layouts/AppShell'
import { PhotoCapture } from '@/components/PhotoCapture'
import {
  categoryFromAge,
  computeAge,
  getActiveCategoryNames
} from '@shared/utils/judoka'

interface Props {
  createdBy: string
  createdWorkstation: string
  onBack: () => void
  onSaved: (result?: { synced?: boolean; queueSize?: number; local?: boolean }) => void
  /** Mode édition */
  editing?: Judoka | null
  embedded?: boolean
}

type FormState = {
  lastName: string
  middleName: string
  firstName: string
  sex: 'M' | 'F'
  birthDate: string
  province: string
  city: string
  commune: string
  address: string
  phone: string
  email: string
  club: string
  league: string
  sportProvince: string
  grade: string
  belt: string
  category: string
  weightKg: string
  heightCm: string
  licenseNumber: string
  affiliationYear: string
}

const empty: FormState = {
  lastName: '',
  middleName: '',
  firstName: '',
  sex: 'M',
  birthDate: '',
  province: '',
  city: '',
  commune: '',
  address: '',
  phone: '',
  email: '',
  club: '',
  league: '',
  sportProvince: '',
  grade: '',
  belt: '',
  category: '',
  weightKg: '',
  heightCm: '',
  licenseNumber: '',
  affiliationYear: String(new Date().getFullYear())
}

/**
 * Formulaire ergonomique d'enregistrement / édition judoka.
 */
export function JudokaFormPage({
  createdBy,
  createdWorkstation,
  onBack,
  onSaved,
  editing = null,
  embedded = false
}: Props) {
  const [form, setForm] = useState<FormState>(empty)
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicateHint, setDuplicateHint] = useState<string | null>(null)
  const isEdit = Boolean(editing?.id)

  useEffect(() => {
    if (!editing) return
    setForm({
      lastName: editing.lastName,
      middleName: editing.middleName,
      firstName: editing.firstName,
      sex: editing.sex,
      birthDate: editing.birthDate,
      province: editing.province,
      city: editing.city,
      commune: editing.commune,
      address: editing.address,
      phone: editing.phone,
      email: editing.email,
      club: editing.club,
      league: editing.league,
      sportProvince: editing.sportProvince,
      grade: editing.grade,
      belt: editing.belt,
      category: editing.category,
      weightKg: editing.weightKg != null ? String(editing.weightKg) : '',
      heightCm: editing.heightCm != null ? String(editing.heightCm) : '',
      licenseNumber: editing.licenseNumber,
      affiliationYear:
        editing.affiliationYear != null
          ? String(editing.affiliationYear)
          : String(new Date().getFullYear())
    })
    setPhotoPath(editing.photoPath)
  }, [editing])

  const age = useMemo(
    () => (form.birthDate.match(/^\d{4}-\d{2}-\d{2}$/) ? computeAge(form.birthDate) : null),
    [form.birthDate]
  )

  const categoryOptions = getActiveCategoryNames()

  // Dès que l'âge est détecté → catégorie appropriée
  useEffect(() => {
    if (age === null) return
    const next = categoryFromAge(age)
    if (!next) return
    setForm((prev) => (prev.category === next ? prev : { ...prev, category: next }))
  }, [age])

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submit(force = false): Promise<void> {
    setBusy(true)
    setError(null)
    setDuplicateHint(null)

    const body = {
      ...form,
      weightKg: form.weightKg ? Number(form.weightKg) : null,
      heightCm: form.heightCm ? Number(form.heightCm) : null,
      affiliationYear: form.affiliationYear ? Number(form.affiliationYear) : null,
      photoPath,
      createdBy,
      createdWorkstation,
      force
    }

    const res = isEdit
      ? await window.judovac.updateJudoka(editing!.id, body)
      : await window.judovac.createJudoka(body)
    setBusy(false)

    if (!res.ok) {
      if (res.code === 'DUPLICATE') {
        setDuplicateHint(
          res.error ||
            'Doublon bloqué : Nom, Postnom, Prénom, Date de naissance et Club déjà enregistrés.'
        )
        setError(res.error)
        return
      }
      setError(res.error)
      return
    }

    const data = res.data as {
      synced?: boolean
      queueSize?: number
      local?: boolean
      queued?: boolean
    } | null
    onSaved({
      synced: Boolean(data?.synced),
      queueSize: data?.queueSize,
      local: Boolean(data?.local ?? data?.queued)
    })
  }

  function onSubmit(e: FormEvent): void {
    e.preventDefault()
    void submit(false)
  }

  return (
    <AppShell
      embedded={embedded}
      title={isEdit ? `Modifier ${editing?.displayId ?? ''}` : 'Nouveau judoka'}
      subtitle="Informations personnelles et sportives"
      actions={
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Button>
      }
    >
      <form onSubmit={onSubmit} className="mx-auto max-w-4xl space-y-8 animate-fade-in">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-judo-navy">Informations personnelles</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Nom *" id="lastName">
              <Input
                id="lastName"
                required
                value={form.lastName}
                onChange={(e) => set('lastName', e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Postnom" id="middleName">
              <Input
                id="middleName"
                value={form.middleName}
                onChange={(e) => set('middleName', e.target.value)}
              />
            </Field>
            <Field label="Prénom *" id="firstName">
              <Input
                id="firstName"
                required
                value={form.firstName}
                onChange={(e) => set('firstName', e.target.value)}
              />
            </Field>
            <Field label="Sexe *" id="sex">
              <select
                id="sex"
                className="flex h-10 w-full rounded-md border border-input bg-white/80 px-3 text-sm"
                value={form.sex}
                onChange={(e) => set('sex', e.target.value as 'M' | 'F')}
              >
                <option value="M">Masculin</option>
                <option value="F">Féminin</option>
              </select>
            </Field>
            <Field label="Date de naissance *" id="birthDate">
              <Input
                id="birthDate"
                type="date"
                required
                value={form.birthDate}
                onChange={(e) => set('birthDate', e.target.value)}
              />
            </Field>
            <Field label="Âge (auto)" id="age">
              <Input id="age" readOnly value={age === null ? '' : String(age)} className="bg-muted/50" />
            </Field>
            <Field label="Province" id="province">
              <Input id="province" value={form.province} onChange={(e) => set('province', e.target.value)} />
            </Field>
            <Field label="Ville" id="city">
              <Input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </Field>
            <Field label="Commune" id="commune">
              <Input id="commune" value={form.commune} onChange={(e) => set('commune', e.target.value)} />
            </Field>
            <Field label="Adresse" id="address">
              <Input id="address" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
            <Field label="Téléphone" id="phone">
              <Input id="phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field label="Email" id="email">
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-judo-navy">Informations sportives</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Club" id="club">
              <Input id="club" value={form.club} onChange={(e) => set('club', e.target.value)} />
            </Field>
            <Field label="Ligue" id="league">
              <Input id="league" value={form.league} onChange={(e) => set('league', e.target.value)} />
            </Field>
            <Field label="Province sportive" id="sportProvince">
              <Input
                id="sportProvince"
                value={form.sportProvince}
                onChange={(e) => set('sportProvince', e.target.value)}
              />
            </Field>
            <Field label="Grade" id="grade">
              <Input id="grade" value={form.grade} onChange={(e) => set('grade', e.target.value)} />
            </Field>
            <Field label="Ceinture" id="belt">
              <Input id="belt" value={form.belt} onChange={(e) => set('belt', e.target.value)} />
            </Field>
            <Field label="Catégorie (auto)" id="category">
              <select
                id="category"
                className="flex h-10 w-full rounded-md border border-input bg-white/80 px-3 text-sm"
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
              >
                <option value="">— Sélectionner —</option>
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                {form.category && !categoryOptions.includes(form.category) && (
                    <option value={form.category}>{form.category}</option>
                  )}
              </select>
            </Field>
            <Field label="Poids (kg)" id="weightKg">
              <Input
                id="weightKg"
                type="number"
                step="0.1"
                min="0"
                placeholder="Ex. 73"
                value={form.weightKg}
                onChange={(e) => set('weightKg', e.target.value)}
              />
            </Field>
            <Field label="N° licence" id="licenseNumber">
              <Input
                id="licenseNumber"
                value={form.licenseNumber}
                onChange={(e) => set('licenseNumber', e.target.value)}
              />
            </Field>
            <Field label="Année affiliation" id="affiliationYear">
              <Input
                id="affiliationYear"
                type="number"
                value={form.affiliationYear}
                onChange={(e) => set('affiliationYear', e.target.value)}
              />
            </Field>
          </div>
        </section>

        <PhotoCapture value={photoPath} onChange={setPhotoPath} />

        {error && <p className="text-sm text-destructive">{error}</p>}

        {duplicateHint && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-medium">Enregistrement refusé</p>
            <p className="mt-1">{duplicateHint}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setDuplicateHint(null)}>
                Modifier le formulaire
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
                Annuler
              </Button>
            </div>
          </div>
        )}

        {!duplicateHint && (
          <div className="flex gap-3">
            <Button type="submit" variant="accent" size="lg" disabled={busy}>
              <Save className="h-4 w-4" />
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={onBack} disabled={busy}>
              Annuler
            </Button>
          </div>
        )}
      </form>
    </AppShell>
  )
}

function Field({
  label,
  id,
  children
}: {
  label: string
  id: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
