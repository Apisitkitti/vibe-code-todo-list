const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });

  // Sign in
  await p.goto('http://127.0.0.1:3455/sign-in');
  await p.fill('input[type="email"]', 'sparker@example.com');
  await p.fill('input[type="password"]', 'Kitchen2024!');
  await p.click('button:has-text("Sign in")');
  await p.waitForTimeout(2000);

  // Mark buy milk as done
  await p.evaluate(() => {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    if (checkboxes.length > 2) {
      checkboxes[2].click();
    }
  });

  await p.waitForTimeout(500);

  // Mark Emma as done (which will open date picker)
  const todoRows1 = await p.locator('[class*="rounded"][class*="border"]').all();
  for (let i = 0; i < todoRows1.length; i++) {
    const text = await todoRows1[i].textContent();
    if (text && text.includes('Emma dentist Thursday')) {
      const buttons = await todoRows1[i].locator('button').all();
      if (buttons.length > 0) {
        await buttons[0].click();
      }
      break;
    }
  }

  await p.waitForTimeout(500);

  // Click Undo
  await p.click('button:has-text("Undo")');

  // Wait for the toast to disappear
  await p.waitForTimeout(3000);

  // Now try to click the edit icon directly using JavaScript to avoid the toast interference
  await p.evaluate(() => {
    // Find the Emma item
    const items = document.querySelectorAll('[class*="rounded"][class*="border"]');
    for (const item of items) {
      if (item.textContent.includes('Emma dentist Thursday')) {
        // Find the edit button (should be the second button)
        const buttons = item.querySelectorAll('button');
        if (buttons.length > 1) {
          buttons[1].click(); // Click edit button
        }
        break;
      }
    }
  });

  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/persona1-18.png', fullPage: true });
  console.log('URL:', p.url());

  await b.close();
})();
