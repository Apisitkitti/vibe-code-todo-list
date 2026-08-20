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

  // Now the full edit modal should be open
  // Let me click on the Due date input field to open a date picker
  const dateInputs = await p.locator('input[placeholder="mm/dd/yyyy"]').all();
  console.log(`Found ${dateInputs.length} date inputs`);

  if (dateInputs.length > 0) {
    await dateInputs[0].click();
    console.log('Clicked date input field');
  }

  // Also try clicking the calendar button next to the date field
  const calendarButtons = await p.locator('[aria-label*="Calendar"], button svg[viewBox*="calendar"]').all();
  console.log(`Found ${calendarButtons.length} calendar buttons`);

  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/date-input-focus.png', fullPage: true });

  await b.close();
})();
