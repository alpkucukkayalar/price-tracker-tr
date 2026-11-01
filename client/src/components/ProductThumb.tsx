import { useState } from 'react'
import { Package } from 'lucide-react'

/** Small product image with a neutral placeholder when missing or broken. */
export default function ProductThumb({ url, size = 56, className = '' }: { url?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size }
  if (!url || broken) {
    return (
      <div style={style} className={`flex-shrink-0 rounded-lg bg-surface-hover border border-border flex items-center justify-center text-text-muted ${className}`}>
        <Package style={{ width: size * 0.45, height: size * 0.45 }} />
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      style={style}
      className={`flex-shrink-0 rounded-lg bg-white object-contain p-0.5 border border-border ${className}`}
    />
  )
}
