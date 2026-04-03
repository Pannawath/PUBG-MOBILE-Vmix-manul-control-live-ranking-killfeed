const { test, expect } = require('@playwright/test');

test('Ranking Overlay should load', async ({ page }) => {
    // Route moved to /overlay/ranking based on App.jsx
    await page.goto('http://localhost:5173/overlay/ranking');
    await expect(page.locator('body')).toBeVisible();
});

test('Top 4 Overlay should load', async ({ page }) => {
    // Route moved to /overlay/top4 based on App.jsx
    await page.goto('http://localhost:5173/overlay/top4');
    await expect(page.locator('body')).toBeVisible();
});
