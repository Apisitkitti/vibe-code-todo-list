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

  // Click the calendar button for Emma
  const todoRows = await p.locator('[class*="rounded"][class*="border"]').all();
  for (let i = 0; i < todoRows.length; i++) {
    const text = await todoRows[i].textContent();
    if (text && text.includes('Emma dentist Thursday')) {
      const buttons = await todoRows[i].locator('button').all();
      if (buttons.length > 0) {
        await buttons[0].click(); // Click the calendar button
      }
      break;
    }
  }

  await p.waitForTimeout(1000);

  // The modal should be open now
  // Try to find the due date input by its text content or by finding all inputs
  const allInputs = await p.locator('input').all();
  console.log(`Found ${allInputs.length} input fields`);

  // Find the due date input - it should have "mm/dd/yyyy" as placeholder or value
  let dateInput = null;
  for (let i = 0; i < allInputs.length; i++) {
    const placeholder = await allInputs[i].getAttribute('placeholder');
    const type = await allInputs[i].getAttribute('type');
    console.log(`Input ${i}: type=${type}, placeholder=${placeholder}`);
    if (placeholder && placeholder.includes('mm/dd')) {
      dateInput = allInputs[i];
      console.log(`Found date input at index ${i}`);
      break;
    }
  }

  if (dateInput) {
    await dateInput.click();
    await p.waitForTimeout(300);
    await dateInput.fill('08/20/2026');
  } else {
    console.log('Could not find date input');
  }

  await p.waitForTimeout(800);
  await p.screenshot({ path: '/tmp/persona1-12.png', fullPage: true });
  console.log('URL:', p.url());

  await b.close();
})();
