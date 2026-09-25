import { expect, test } from './support/fresh-storage'

import { documentText, insertText, openEditor } from './support/editor'

test.describe('Writer Classic editor [heading]', () => {
  test('renders a heading, marker included, in bold at body size', async ({
    page,
  }) => {
    await openEditor(page)
    await insertText(page, '# Title')

    await expect(documentText(page)).toHaveText('# Title')
    const style = await fontStyle(page, '# Title', '# Title')
    expect(Number(style.weight)).toBeGreaterThanOrEqual(600)
    expect(style.size).toBe(
      await page.locator('.cm-content').evaluate((node) => getComputedStyle(node).fontSize),
    )
  })
})

async function fontStyle(page: import('@playwright/test').Page, line: string, fragment: string) {
  return page.locator('.cm-line', { hasText: line }).evaluate((node, needle) => {
    const spans = Array.from(node.querySelectorAll('span'))
    const match = spans.find((span) => span.textContent?.includes(needle))
    const target = match ?? node
    const style = getComputedStyle(target)
    return { weight: style.fontWeight, size: style.fontSize }
  }, fragment)
}
