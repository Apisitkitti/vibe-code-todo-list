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

  // Now click the calendar button for Emma dentist
  // Dismiss the notification first by clicking somewhere else or waiting for it to disappear
  await p.waitForTimeout(1000);

  // Find and click the calendar button for Emma dentist
  const todoRows = await p.locator('[class*="rounded"][class*="border"]').all();
  for (let i = 0; i < todoRows.length; i++) {
    const text = await todoRows[i].textContent();
    if (text && text.includes('Emma dentist Thursday')) {
      console.log(`Found Emma at index ${i}`);
      const buttons = await todoRows[i].locator('button').all();
      console.log(`This item has ${buttons.length} buttons`);
      if (buttons.length > 0) {
        await buttons[0].click(); // Click calendar button
        console.log('Clicked calendar button for Emma');
      }
      break;
    }
  }

  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/persona1-16.png', fullPage: true });
  console.log('URL:', p.url());

  await b.close();
})();
