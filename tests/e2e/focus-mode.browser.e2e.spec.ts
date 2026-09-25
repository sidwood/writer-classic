import { expect, test } from './support/fresh-storage'

import { documentText, insertText, openEditor } from './support/editor'

test.describe('Writer Classic editor [focus mode]', () => {
  test('dims and blurs every sentence except the one at the caret', async ({
    page,
  }) => {
    await openEditor(page)
    await insertText(page, 'First sentence. Second sentence.')
    await page.keyboard.press('Meta+Home')
    await page.keyboard.press('Meta+d')

    const inactive = page.locator('.unfocused-sentence')
    await expect(inactive).toContainText('Second sentence.')
    await expect(inactive).toHaveCSS('filter', 'blur(0.8px)')
    await expect(inactive).toHaveCSS('opacity', '0.85')
    await expect(inactive).toHaveCSS('color', 'rgb(184, 184, 184)')
    expect(
      await documentText(page).evaluate((editor) =>
        editor.textContent?.startsWith('First sentence.') &&
        !editor.querySelector('.unfocused-sentence')?.textContent?.includes('First sentence.'),
      ),
    ).toBe(true)
  })
})
