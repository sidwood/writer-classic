import { expect, test } from './support/fresh-storage'

import { openEditor } from './support/editor'

test.describe('Writer Classic editor [dark mode]', () => {
  test('View Dark Mode checks the item and paints the page dark', async ({
    page,
  }) => {
    await openEditor(page)
    const view = page
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: 'View' }) })
    await view.locator('summary').click()
    const toggle = view.getByRole('menuitemcheckbox', { name: 'Dark Mode' })

    await toggle.click()

    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.locator('body')).toHaveCSS(
      'background-color',
      'rgb(32, 33, 36)',
    )
  })
})
