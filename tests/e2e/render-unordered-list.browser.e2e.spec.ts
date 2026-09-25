import { expect, test } from './support/fresh-storage'

import { documentText, openEditor } from './support/editor'

test.describe('Writer Classic editor [unordered list]', () => {
  test('renders an unordered list with an ordinary marker', async ({ page }) => {
    await openEditor(page)
    await documentText(page).fill('- Apples\n- Pears')

    await expect(documentText(page).locator('.cm-line')).toHaveText([
      '- Apples',
      '- Pears',
    ])
    expect(Number(await markerWeight(page, '- Apples', '-'))).toBeLessThan(600)
  })
})

async function markerWeight(page: import('@playwright/test').Page, line: string, marker: string) {
  return page.locator('.cm-line', { hasText: line }).evaluate((node, needle) => {
    const spans = Array.from(node.querySelectorAll('span'))
    const match = spans.find((span) => span.textContent === needle)
    return getComputedStyle(match ?? node).fontWeight
  }, marker)
}
