import { useEffect } from 'react'
import { t } from './lib/i18n'

export default function useTitle(title: string) {
  useEffect(() => {
    const prev = document.title
    document.title = title ? `${title} | Price Tracker` : t('Price Tracker')
    return () => { document.title = prev }
  }, [title])
}
