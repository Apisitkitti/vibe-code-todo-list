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

  await p.waitForTimeout(800);

  // Click "Pick a date..." to open the full calendar
  await p.click('text=Pick a date');

  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/persona1-11.png', fullPage: true });
  console.log('URL:', p.url());

  await b.close();
})();
