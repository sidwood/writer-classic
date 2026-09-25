import { expect, test } from './support/fresh-storage'

import { documentText, insertText, openEditor } from './support/editor'

test.describe('Writer Classic editor [edit text]', () => {
  test('types into the document and leaves that text in the editor', async ({
    page,
  }) => {
    await openEditor(page)

    await insertText(page, 'A line I typed.')

    await expect(documentText(page)).toHaveText('A line I typed.')
  })
})
