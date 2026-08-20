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

  await p.waitForTimeout(1000);

  // Mark Emma as done too (click calendar icon)
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

  await p.waitForTimeout(1000);

  // Click Undo to revert
  await p.click('button:has-text("Undo")');

  await p.waitForTimeout(1000);

  // Now let me try clicking the edit icon (pencil) instead to edit the date
  const todoRows2 = await p.locator('[class*="rounded"][class*="border"]').all();
  for (let i = 0; i < todoRows2.length; i++) {
    const text = await todoRows2[i].textContent();
    if (text && text.includes('Emma dentist Thursday')) {
      const buttons = await todoRows2[i].locator('button').all();
      console.log(`Emma item has ${buttons.length} buttons`);
      // The pencil/edit button should be the second button (index 1)
      if (buttons.length > 1) {
        await buttons[1].click(); // Click edit button
        console.log('Clicked edit button');
      }
      break;
    }
  }

  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/persona1-17.png', fullPage: true });
  console.log('URL:', p.url());

  await b.close();
})();
