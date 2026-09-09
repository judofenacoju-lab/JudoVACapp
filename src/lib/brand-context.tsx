import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { APP_NAME } from '@shared/constants/app'
import {
  getActiveBrandLogo,
  getActiveBrandName,
  resolveBrandLogo,
  resolveBrandName,
  setActiveBrand,
  subscribeBrandChanged
} from '@shared/utils/branding'
import brandLogo from '@/assets/brand-logo.png'
import { useAuth } from '@/lib/auth-context'

interface BrandValue {
  name: string
  logoSrc: string
}

const BrandContext = createContext<BrandValue>({
  name: APP_NAME,
  logoSrc: brandLogo
})

export function BrandProvider({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth()
  const [name, setName] = useState(getActiveBrandName)
  const [logoSrc, setLogoSrc] = useState(() => getActiveBrandLogo() || brandLogo)

  useEffect(() => {
    let cancelled = false
    async function refresh(): Promise<void> {
      const res = await window.judovac.getSettings()
      if (cancelled || !res.ok) return
      const nextName = resolveBrandName(res.data.event.name)
      const nextLogo = resolveBrandLogo(res.data.event.logoDataUrl) || brandLogo
      setActiveBrand(res.data.event.name, res.data.event.logoDataUrl)
      setName(nextName)
      setLogoSrc(nextLogo)
    }
    if (!loading && profile?.active) void refresh()
    return subscribeBrandChanged(() => {
      setName(getActiveBrandName())
      setLogoSrc(getActiveBrandLogo() || brandLogo)
    })
  }, [loading, profile?.active, profile?.id])

  return <BrandContext.Provider value={{ name, logoSrc }}>{children}</BrandContext.Provider>
}

export function useBrand(): BrandValue {
  return useContext(BrandContext)
}
