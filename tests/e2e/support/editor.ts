import type { Page } from '@playwright/test'

export function documentText(page: Page) {
  return page.getByRole('textbox', { name: 'Document text' })
}

export async function openEditor(page: Page) {
  await page.goto('/')
  await documentText(page).click()
  await page.keyboard.press('Escape')
}

export async function insertText(page: Page, text: string) {
  await page.keyboard.press('i')
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
}
