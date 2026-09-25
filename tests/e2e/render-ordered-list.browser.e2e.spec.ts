import { expect, test } from './support/fresh-storage'

import { documentText, openEditor } from './support/editor'

test.describe('Writer Classic editor [ordered list]', () => {
  test('renders an ordered list with an ordinary marker', async ({ page }) => {
    await openEditor(page)
    await documentText(page).fill('1. First\n2. Second')

    await expect(documentText(page).locator('.cm-line')).toHaveText([
      '1. First',
      '2. Second',
    ])
    expect(Number(await markerWeight(page, '1. First', '1.'))).toBeLessThan(600)
  })
})

async function markerWeight(page: import('@playwright/test').Page, line: string, marker: string) {
  return page.locator('.cm-line', { hasText: line }).evaluate((node, needle) => {
    const spans = Array.from(node.querySelectorAll('span'))
    const match = spans.find((span) => span.textContent === needle)
    return getComputedStyle(match ?? node).fontWeight
  }, marker)
}
