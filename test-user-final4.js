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

  // Try clicking the calendar icon button using JavaScript to find it
  await p.evaluate(() => {
    // Find all buttons in the modal
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      // Look for a button that contains an svg with calendar-like attributes
      const svg = btn.querySelector('svg');
      if (svg && svg.getAttribute('viewBox')) {
        const viewBox = svg.getAttribute('viewBox');
        // Calendar icon should be around 24x24 or similar
        if (viewBox && (viewBox.includes('24') || viewBox.includes('20'))) {
          // Try to find a button next to the date input
          const parent = btn.closest('div');
          if (parent && parent.textContent.includes('Due date')) {
            console.log('Found calendar button, clicking it');
            btn.click();
            return;
          }
        }
      }
    }
  });

  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/after-calendar-button-click.png', fullPage: true });

  await b.close();
})();
