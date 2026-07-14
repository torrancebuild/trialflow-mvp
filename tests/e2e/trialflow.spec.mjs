import { expect, test } from 'playwright/test'

async function openMaya(page) {
  await page.goto('/')
  await page.getByRole('button', { name: /Maya Tan/ }).click()
}

test('happy path requires approval and renders the sent reply', async ({ page }) => {
  await openMaya(page)
  await page.getByRole('button', { name: 'Offer slots' }).click()
  await page.getByRole('button', { name: /Sat, 24 May 2025/ }).click()

  const confirm = page.getByRole('button', { name: 'Confirm booking' })
  await expect(confirm).toBeDisabled()
  await page.getByRole('button', { name: 'Approve draft' }).click()
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await page.getByRole('button', { name: 'Send reply' }).click()

  await expect(page.locator('.message.outgoing', { hasText: 'Great choice. Please approve this reply to confirm the sat trial slot.' })).toBeVisible()
  await expect(page.locator('.composer-input')).toHaveText('Reply sent to customer')
  await expect(page.locator('.activity-list p', { hasText: 'Reply sent to customer' })).toBeVisible()
})

test('human review requires takeover before approval', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Farah Q\./ }).click()
  await expect(page.getByText('Human judgment needed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve draft' })).toBeDisabled()
  await page.getByRole('button', { name: 'Take over' }).click()
  await expect(page.getByRole('button', { name: 'Approve draft' })).toBeEnabled()
})

test('missing, no-slot, unknown, and low-confidence tasks remain safe', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Wei Jun/ }).click()
  await expect(page.getByText('Missing information')).toBeVisible()
  await expect(page.getByText('0 matching slots')).toHaveCount(0)

  await page.getByRole('button', { name: /No slots fixture/ }).click()
  await expect(page.getByText('No available slots match')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Offer slots' })).toHaveCount(0)

  await page.getByRole('button', { name: /Sam Lee/ }).click()
  await expect(page.locator('.decision-summary p')).toHaveText(/unsupported intent/)

  await page.getByRole('button', { name: /Aisha Noor/ }).click()
  await expect(page.locator('.decision-summary p')).toHaveText(/low confidence/)
})

test('reloading resets the local simulation state', async ({ page }) => {
  await openMaya(page)
  await page.getByRole('button', { name: 'Offer slots' }).click()
  await expect(page.getByText('Awaiting customer reply', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Ready to offer slots', { exact: true })).toBeVisible()
})
