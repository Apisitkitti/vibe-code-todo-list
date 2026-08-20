const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });

  // Sign in
  await p.goto('http://127.0.0.1:3455/sign-in');
  await p.fill('input[type="email"]', 'sparker@example.com');
  await p.fill('input[type="password"]', 'Kitchen2024!');
  await p.click('button:has-text("Sign in")');
  await p.waitForTimeout(2500);

  // Find Emma and click calendar button
  const todoRows = await p.locator('[class*="rounded"][class*="border"]').all();
  for (let i = 0; i < todoRows.length; i++) {
    const text = await todoRows[i].textContent();
    if (text && text.includes('Emma dentist Thursday')) {
      const buttons = await todoRows[i].locator('button').all();
      if (buttons.length > 0) {
        await buttons[0].click();
      }
      break;
    }
  }

  await p.waitForTimeout(1000);

  // Click Pick a date
  await p.click('text=Pick a date');
  await p.waitForTimeout(1000);

  // Set the date input value using JavaScript
  // HTML5 date inputs use YYYY-MM-DD format
  await p.evaluate(() => {
    const dateInput = document.querySelector('input[type="date"]');
    if (dateInput) {
      console.log('Found date input, setting value to 2026-08-26');
      dateInput.value = '2026-08-26';
      // Trigger change event
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      console.log('Date input not found');
    }
  });

  await p.waitForTimeout(1000);
  await p.screenshot({ path: '/tmp/date-set.png', fullPage: true });
  console.log('Date set via JavaScript');

  await b.close();
})();
