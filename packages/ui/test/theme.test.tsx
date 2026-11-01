// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ThemeToggle } from '../src/components/theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

it('prefers the saved theme and persists both directions of a toggle', async () => {
  localStorage.setItem('quotedb-theme', 'dark')
  const user = userEvent.setup()
  render(<ThemeToggle />)
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Switch to light mode' }))
  expect(document.documentElement.classList.contains('dark')).toBe(false)
  expect(localStorage.getItem('quotedb-theme')).toBe('light')
  await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  expect(localStorage.getItem('quotedb-theme')).toBe('dark')
})

it('uses the OS preference when the saved value is invalid', () => {
  localStorage.setItem('quotedb-theme', 'invalid')
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  render(<ThemeToggle />)
  expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeTruthy()
  expect(localStorage.getItem('quotedb-theme')).toBe('dark')
})

it('honors saved light mode even when the OS prefers dark mode', () => {
  localStorage.setItem('quotedb-theme', 'light')
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  render(<ThemeToggle />)
  expect(document.documentElement.classList.contains('dark')).toBe(false)
})

it('still toggles when browser storage is blocked', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const user = userEvent.setup()
  render(<ThemeToggle />)
  await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
  expect(document.documentElement.classList.contains('dark')).toBe(true)
})

it('defaults to light mode when media-query support is unavailable', () => {
  vi.stubGlobal('matchMedia', undefined)
  render(<ThemeToggle />)
  expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeTruthy()
})
