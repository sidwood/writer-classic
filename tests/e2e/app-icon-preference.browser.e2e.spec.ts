import { expect, test } from './support/fresh-storage'
import { openEditor } from './support/editor'

test('app icon defaults light and dark requires a persistent explicit choice independent of theme', async ({ page }) => {
  await openEditor(page)
  await page.getByText('View', { exact: true }).click()
  const light = page.getByRole('menuitemcheckbox', { name: 'Light App Icon' })
  const dark = page.getByRole('menuitemcheckbox', { name: 'Dark App Icon' })
  await expect(light).toHaveAttribute('aria-checked', 'true')
  await expect(dark).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('menuitemcheckbox', { name: 'Dark Mode' }).click()
  await expect(light).toHaveAttribute('aria-checked', 'true')
  await dark.click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('writer-classic.app-icon'))).toBe('dark')
  await page.reload()
  await page.getByText('View', { exact: true }).click()
  await expect(dark).toHaveAttribute('aria-checked', 'true')
  await expect(light).toHaveAttribute('aria-checked', 'false')
})

test('invalid stored app icon choice falls back to light', async ({ page }) => {
  await openEditor(page)
  await page.evaluate(() => localStorage.setItem('writer-classic.app-icon', 'system'))
  await page.reload()
  await page.getByText('View', { exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Light App Icon' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('menuitemcheckbox', { name: 'Dark App Icon' })).toHaveAttribute('aria-checked', 'false')
})
