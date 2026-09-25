import { expect, test } from './support/fresh-storage'

import { documentText, openEditor } from './support/editor'

test.describe('Writer Classic editor [vim visual]', () => {
  test('v, V, and Ctrl-v show a visible visual indicator', async ({ page }) => {
    await openEditor(page)
    await page.keyboard.press('i')
    await page.keyboard.type('abc\ndef\nghi')
    await page.keyboard.press('Escape')
    await expect(documentText(page).locator('.cm-line')).toHaveText([
      'abc',
      'def',
      'ghi',
    ])

    await page.keyboard.type('gg0vl')
    await expect(page.getByLabel('Vim state')).toHaveText('VISUAL')
    await page.keyboard.press('Escape')

    await page.keyboard.type('gg0V')
    await expect(page.getByLabel('Vim state')).toHaveText('VISUAL LINE')
    await page.keyboard.press('Escape')

    await page.keyboard.type('gg0')
    await page.keyboard.press('Control+v')
    await page.keyboard.type('jl')
    await expect(page.getByLabel('Vim state')).toHaveText('VISUAL BLOCK')
  })
})
