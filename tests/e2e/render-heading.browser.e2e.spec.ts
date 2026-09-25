import { expect, test } from './support/fresh-storage'

import { documentText, insertText, openEditor } from './support/editor'

test.describe('Writer Classic editor [heading]', () => {
  test('renders a heading, marker included, with the word in bold at body size', async ({
    page,
  }) => {
    await openEditor(page)
    await insertText(page, '# Title')

    await expect(documentText(page)).toHaveText('# Title')
    const word = await textStyle(page, 'Title')
    expect(Number(word.weight)).toBeGreaterThanOrEqual(600)
    expect(word.size).toBe(
      await page.locator('.cm-content').evaluate((node) => getComputedStyle(node).fontSize),
    )
    const mark = await textStyle(page, '#')
    expect(Number(mark.weight)).toBeLessThan(600)
  })
})

async function textStyle(page: import('@playwright/test').Page, fragment: string) {
  return page.locator('.cm-line', { hasText: '# Title' }).evaluate((node, needle) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent?.includes(needle)) continue
      const style = getComputedStyle(text.parentElement!)
      return { weight: style.fontWeight, size: style.fontSize }
    }
    const style = getComputedStyle(node)
    return { weight: style.fontWeight, size: style.fontSize }
  }, fragment)
}
