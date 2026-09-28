/** Shared chat composer capsule; each surface owns its editor and allowed controls. */
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react'
import clsx from 'clsx'
import css from './ComposerCard.module.css'

/** Native capsule attributes and surface-owned content. */
export type ComposerCardProps = HTMLAttributes<HTMLDivElement>

/**
 * Render the shared workspace and room composer surface.
 * @param props - native attributes and editor, attachment and control children.
 * @returns the capsule with the caller's forwarded anchor reference.
 */
export const ComposerCard = forwardRef<HTMLDivElement, ComposerCardProps>(function ComposerCard({ className, ...props }, ref) {
  return <div {...props} ref={ref} className={clsx(css.card, className)} data-composer-card />
})

/**
 * Render the shared composer control row with responsive sizing.
 * @param props - native row attributes and allowed surface controls.
 * @returns the control row with the caller's forwarded layout reference.
 */
export const ComposerControlRow = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ComposerControlRow(
  { className, ...props }, ref,
) {
  return <div {...props} ref={ref} className={clsx(css.row, className)} />
})

/**
 * Render the shared send action, optionally showing a surface-owned stop glyph.
 * @param props - native button attributes and optional alternate glyph.
 * @returns the themed composer action.
 */
export const ComposerSendButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function ComposerSendButton(
  { className, children, ...props }, ref,
) {
  return <button type="button" {...props} ref={ref} className={clsx(css.primary, className)}>{children ??
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
    </svg>
  }</button>
})
