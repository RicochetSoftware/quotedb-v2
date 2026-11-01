import type * as React from 'react'

export function QuoteText({
  quote,
  author,
  meta,
  size = 'default',
  actions,
}: {
  quote: string
  author: string
  meta?: React.ReactNode
  size?: 'default' | 'large'
  actions?: React.ReactNode
}) {
  return (
    <figure className={size === 'large' ? 'space-y-4 text-center' : 'space-y-1.5'}>
      <blockquote
        className={size === 'large' ? 'text-2xl leading-snug font-medium sm:text-3xl' : 'text-base'}
      >
        “{quote}”
      </blockquote>
      <figcaption className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <span className={size === 'large' ? 'w-full text-base' : ''}>— {author}</span>
        {meta}
        {actions && <span className="ml-auto flex gap-1">{actions}</span>}
      </figcaption>
    </figure>
  )
}
