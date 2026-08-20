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

  await p.screenshot({ path: '/tmp/signed-in.png', fullPage: true });
  console.log('Signed in, URL:', p.url());

  // Find Emma dentist and click the calendar button to open the date picker
  const todoRows = await p.locator('[class*="rounded"][class*="border"]').all();
  console.log(`Found ${todoRows.length} todo items`);

  let found = false;
  for (let i = 0; i < todoRows.length; i++) {
    const text = await todoRows[i].textContent();
    if (text && text.includes('Emma dentist Thursday')) {
      console.log(`Found Emma at index ${i}`);
      const buttons = await todoRows[i].locator('button').all();
      console.log(`Emma item has ${buttons.length} buttons`);
      // First button should be calendar
      if (buttons.length > 0) {
        await buttons[0].click();
        found = true;
        console.log('Clicked calendar button for Emma');
      }
      break;
    }
  }

  if (!found) {
    console.log('Could not find Emma dentist item');
  }

  await p.waitForTimeout(1000);
  await p.screenshot({ path: '/tmp/after-calendar-click.png', fullPage: true });

  await b.close();
})();
