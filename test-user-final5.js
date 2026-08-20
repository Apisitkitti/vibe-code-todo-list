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

  // Try to find and type into any input field that might be for the date
  const allInputs = await p.locator('input').all();
  console.log(`Found ${allInputs.length} input fields`);

  // Look for the date input - try the last input or one with type="text"
  for (let i = allInputs.length - 1; i >= 0; i--) {
    const placeholder = await allInputs[i].getAttribute('placeholder');
    const type = await allInputs[i].getAttribute('type');
    console.log(`Input ${i}: type=${type}, placeholder=${placeholder}`);

    if (placeholder && placeholder.includes('mm/dd')) {
      console.log(`Found date input at index ${i}, typing date`);
      await allInputs[i].click();
      await p.waitForTimeout(300);
      await allInputs[i].type('08/26/2026');
      console.log('Typed 08/26/2026');
      break;
    }
  }

  await p.waitForTimeout(1000);
  await p.screenshot({ path: '/tmp/date-typed.png', fullPage: true });

  await b.close();
})();
