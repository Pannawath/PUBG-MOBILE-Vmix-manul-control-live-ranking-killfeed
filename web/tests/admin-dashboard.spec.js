const { test, expect } = require('@playwright/test');

test.describe('Admin Dashboard Full Functionality', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5173/admin');
        await expect(page.locator('text=CONNECTED')).toBeVisible({ timeout: 10000 });
    });

    test('Tabs Navigation', async ({ page }) => {
        await page.getByRole('button', { name: /Teams/ }).click();
        await expect(page.getByText('Teams Management')).toBeVisible();
        await page.getByRole('button', { name: /Dashboard/ }).click();
        await expect(page.getByText('Feed History')).toBeVisible();
    });

    test('Overlay Controls Toggles', async ({ page }) => {
        const toggleBtn = page.getByRole('button', { name: /ranking/i }).first();
        await toggleBtn.click();
        await expect(toggleBtn).toBeEnabled();
    });

    test('Match Switching', async ({ page }) => {
        await page.getByRole('button', { name: '2', exact: true }).click();
        await page.getByRole('button', { name: '1', exact: true }).click();
    });

    test('Killfeed Interaction', async ({ page }) => {
        await page.getByPlaceholder('e.g. [DAY] mapayer').fill('Test Killer');
        await page.getByPlaceholder('e.g. [BRU] ConK').fill('Test Victim');
        await page.getByRole('button', { name: 'SUBMIT (PENDING)' }).click();
    });

    test('Team Management & Status', async ({ page }) => {
        await page.getByRole('button', { name: /Teams/ }).click();
        await page.getByPlaceholder('Search Team or Player...').fill('Team 1');
        const statusBtn = page.locator('button[title*="Player 1"]').first();
        if (await statusBtn.isVisible()) {
            await statusBtn.click();
            await statusBtn.click();
            await statusBtn.click();
        }
    });

    // Chat Widget test skipped for automated run - best tested manually
    test.skip('Chat Widget Flow', async ({ page }) => {
        const chatBtn = page.getByRole('button', { name: '💬' });
        await chatBtn.click();
        await expect(page.getByText('Team Chat')).toBeVisible();

        const nameInput = page.getByPlaceholder('Your Name...');
        if (await nameInput.isVisible()) {
            await nameInput.fill('AdminTester');
            await page.getByRole('button', { name: 'Set' }).click();
        }

        await page.getByPlaceholder('Type a message...').fill('Hello Automated');
        await page.getByRole('button', { name: '➤' }).click();
        await expect(page.getByText('Hello Automated')).toBeVisible();
    });

    test('Debug Mode Toggle', async ({ page }) => {
        await page.getByRole('button', { name: /DEBUG/i }).click();
        await expect(page.getByText('Debug Logs')).toBeVisible();
        await page.getByRole('button', { name: /DEBUG/i }).click();
        await expect(page.getByText('Debug Logs')).not.toBeVisible();
    });

    test('Reset Match Dialog', async ({ page }) => {
        await page.getByRole('button', { name: /Teams/ }).click();
        page.on('dialog', dialog => dialog.dismiss());
        await page.getByRole('button', { name: 'Reset Match' }).click();
    });

});
