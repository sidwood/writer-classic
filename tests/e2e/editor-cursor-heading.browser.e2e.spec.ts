import { expect, test } from './support/fresh-storage'
import { documentText, openEditor } from './support/editor'

test('NORMAL block cursor uses the Classic blue with a readable covered glyph in both themes', async ({ page }, testInfo) => {
  await openEditor(page)
  await page.keyboard.press('i')
  await page.keyboard.type('Visible')
  await page.keyboard.press('Escape')
  await page.keyboard.press('0')

  for (const dark of [false, true]) {
    if (dark) {
      await page.getByText('View', { exact: true }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Dark Mode' }).click()
      await page.getByText('View', { exact: true }).click()
      await documentText(page).click()
      await page.keyboard.press('Escape')
      await page.keyboard.press('0')
    }
    const block = page.locator('.cm-vimCursorLayer .cm-fat-cursor.cm-cursor-primary')
    await expect(block).toHaveText('V')
    const colors = await block.evaluate((node, dark) => {
      const style = getComputedStyle(node)
      const root = getComputedStyle(document.documentElement)
      return { background: style.backgroundColor, foreground: style.color, accent: root.getPropertyValue('--accent').trim(), ink: root.getPropertyValue(dark ? '--paper' : '--text').trim() }
    }, dark)
    expect(colors.background).toBe(await page.evaluate((color) => {
      const probe = document.createElement('div')
      probe.style.backgroundColor = color
      document.body.append(probe)
      const result = getComputedStyle(probe).backgroundColor
      probe.remove()
      return result
    }, colors.accent))
    expect(colors.foreground).toBe(await page.evaluate((color) => {
      const probe = document.createElement('div')
      probe.style.color = color
      document.body.append(probe)
      const result = getComputedStyle(probe).color
      probe.remove()
      return result
    }, colors.ink))
    await page.screenshot({ path: testInfo.outputPath(`editor-cursor-${dark ? 'dark' : 'light'}.png`) })
  }
  await page.keyboard.press('d')
  const pending = page.locator('.cm-vimCursorLayer .cm-fat-cursor.cm-cursor-primary')
  await expect(pending).toHaveAttribute('style', /color: transparent/)
  await expect(pending).toHaveCSS('color', 'rgba(0, 0, 0, 0)')
  await page.keyboard.press('Escape')
  await page.keyboard.press('i')
  await expect(page.locator('.cm-vimCursorLayer .cm-fat-cursor')).toHaveCount(0)
  await expect(documentText(page)).toHaveText('Visible')
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await expect(page.getByLabel('Vim state')).toHaveText('VISUAL')
  await expect(page.locator('.writer-editor')).toHaveAttribute('data-vim-mode', 'VISUAL')
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Vim state')).toHaveText('NORMAL')
})

test('typed and formatted Markdown headings keep bold words and regular marks', async ({ page }) => {
  await openEditor(page)
  await page.keyboard.press('i')
  await page.keyboard.type('# Typed')
  await page.keyboard.press('Escape')
  await expect(documentText(page)).toHaveText('# Typed')
  await expect(documentText(page)).toHaveJSProperty('textContent', '# Typed')
  await expect(page.locator('.cm-line').first().locator('.cm-md-gutter')).toHaveCSS('font-weight', '400')
  await expect(page.locator('.cm-line').first().locator('span').last()).toHaveCSS('font-weight', '700')

  await page.getByText('Edit', { exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Vim Mode' }).click()
  await documentText(page).fill('Plain')
  await page.getByRole('button', { name: 'Heading 2' }).click()
  await expect(documentText(page)).toHaveText('## Plain')
  await expect(documentText(page)).toHaveJSProperty('textContent', '## Plain')
  const line = page.locator('.cm-line').first()
  await expect(line.locator('.cm-md-gutter')).toHaveCSS('font-weight', '400')
  await expect(line.locator('span').last()).toHaveCSS('font-weight', '700')
  const size = await page.locator('.cm-content').evaluate((node) => getComputedStyle(node).fontSize)
  await expect(line.locator('span').last()).toHaveCSS('font-size', size)
  await page.getByRole('button', { name: 'Heading 2' }).click()
  await expect(documentText(page)).toHaveText('Plain')
  await expect(line).toHaveCSS('font-weight', '400')
})

test('fenced Markdown is not a heading, and dark headings retain body-size bold words', async ({ page }, testInfo) => {
  await openEditor(page)
  await page.keyboard.press('i')
  await page.keyboard.type('```md\n# Not a heading\n```\n# A heading')
  await page.keyboard.press('Escape')
  const lines = page.locator('.cm-line')
  await expect.poll(async () => (await lines.allTextContents()).join('\n')).toBe('```md\n# Not a heading\n```\n# A heading')
  await expect(lines.nth(1)).toContainText('# Not a heading')
  await expect(lines.nth(1).locator('.cm-md-gutter')).toHaveCount(0)
  await expect(lines.nth(3).locator('.cm-md-gutter')).toHaveCSS('font-weight', '400')

  await page.getByText('View', { exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Dark Mode' }).click()
  await page.getByText('View', { exact: true }).click()
  await documentText(page).click()
  await page.keyboard.press('Escape')
  const word = lines.nth(3).locator('span').last()
  await expect(word).toHaveCSS('font-weight', '700')
  await expect(word).toHaveCSS('font-size', await page.locator('.cm-content').evaluate((node) => getComputedStyle(node).fontSize))
  await page.screenshot({ path: testInfo.outputPath('editor-heading-dark.png') })
})
