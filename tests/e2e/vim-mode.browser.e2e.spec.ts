import { expect, test } from './support/fresh-storage'

import { documentText, openEditor } from './support/editor'

test.describe('Writer Classic editor [vim]', () => {
  test('starts in normal mode, inserts on i, and deletes a word', async ({
    page,
  }) => {
    await openEditor(page)
    await expect(page.getByLabel('Vim state')).toHaveText('NORMAL')

    await page.keyboard.press('i')
    await expect(page.getByLabel('Vim state')).toHaveText('INSERT')
    await page.keyboard.type('alpha beta')
    await page.keyboard.press('Escape')
    await expect(documentText(page)).toHaveText('alpha beta')

    await page.keyboard.type('gg0dw')
    await expect(documentText(page)).toHaveText('beta')
    await expect(page.getByLabel('Vim state')).toHaveText('NORMAL')
  })
})
