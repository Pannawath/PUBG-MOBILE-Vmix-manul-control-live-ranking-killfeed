const { test, expect } = require('@playwright/test');

test('Random Map Functionality', async ({ page }) => {
    await page.goto('http://localhost:3002/control.html');

    const rollBtn = page.locator('#random-btn');
    const statusText = page.locator('#status-text');

    await expect(rollBtn).toBeVisible();

    // Click Roll
    await rollBtn.click();

    // Expect status to change to "Rolling..."
    // Note: in control.html script: statusText.textContent = "Rolling...";
    await expect(statusText).toHaveText('Rolling...', { timeout: 2000 });

    // Wait for it to finish (approx 8 seconds in script)
    // We don't need to wait full duration for test to pass, ensuring interaction worked is enough.
    // But let's check disability
    await expect(rollBtn).toBeDisabled();
});
