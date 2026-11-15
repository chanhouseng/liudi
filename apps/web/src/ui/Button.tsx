import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger'

const baseClass =
  'inline-flex h-11 items-center justify-center gap-2 rounded-doc px-4 text-[15px] font-medium disabled:cursor-not-allowed disabled:opacity-40'

const variantClass: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:opacity-90 focus-visible:outline-ink',
  secondary: 'border border-ink-2 text-ink hover:border-ink',
  danger: 'border border-alert text-alert hover:opacity-90',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${baseClass} ${variantClass[variant]} ${className}`}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  )
}
