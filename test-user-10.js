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

  // I'll try to find all buttons and click the first one (calendar) near Emma
  // First, let me get the page structure
  const html = await p.content();

  // Find buttons that might be for the Emma item
  // Try to use getByText to find the Emma item and then interact with buttons nearby
  const todoRows = await p.locator('[class*="rounded"][class*="border"]').all();
  console.log(`Found ${todoRows.length} todo rows`);

  // Find the Emma row
  for (let i = 0; i < todoRows.length; i++) {
    const text = await todoRows[i].textContent();
    if (text && text.includes('Emma dentist Thursday')) {
      console.log(`Found Emma item at index ${i}`);
      // Click the first button in this row (calendar icon)
      const buttons = await todoRows[i].locator('button').all();
      console.log(`This item has ${buttons.length} buttons`);
      if (buttons.length > 0) {
        await buttons[0].click(); // Click the calendar button
        console.log('Clicked calendar button');
      }
      break;
    }
  }

  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/persona1-10.png', fullPage: true });
  console.log('URL:', p.url());

  await b.close();
})();
