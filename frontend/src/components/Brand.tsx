export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="Crate Digger">
      <div className="brand__name">
        <span>CRATE</span>
        <strong>DIGGER</strong>
      </div>
      {!compact && <div className="brand__tagline">DIG. SAMPLE. CREATE.</div>}
    </div>
  )
}

