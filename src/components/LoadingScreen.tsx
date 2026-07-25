import brandLogo from '@/assets/brand-logo.png'

/** Ancien délai splash — conservé pour imports éventuels */
export const LOADING_DURATION_MS = 0

/**
 * Splash minimal — pas de position:fixed ni transform CSS
 * (évite écran blanc GPU sur certaines tablettes Android).
 */
export function LoadingScreen() {
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        fontFamily: 'system-ui, sans-serif'
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 16
        }}
      >
        <img
          src={brandLogo}
          alt="JudoVACapp"
          width={72}
          height={72}
          style={{ borderRadius: '50%', objectFit: 'cover' }}
        />
        <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: '#0B1F3A' }}>
          Chargement JudoVACapp…
        </p>
      </div>
      <footer
        style={{
          width: '100%',
          background: '#e8e8e8',
          padding: '12px 0',
          textAlign: 'center'
        }}
      >
        <p style={{ margin: 0, fontSize: 14, color: '#4a4a4a' }}>
          Développé par Initiative Judo
        </p>
      </footer>
    </div>
  )
}
