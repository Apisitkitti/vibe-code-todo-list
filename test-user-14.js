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

  // Now let me try to mark one item as done
  // I'll click the checkbox for "buy milk"
  const todoRows = await p.locator('[class*="rounded"][class*="border"]').all();
  for (let i = 0; i < todoRows.length; i++) {
    const text = await todoRows[i].textContent();
    if (text && text.includes('buy milk')) {
      console.log('Found buy milk item');
      const checkbox = await todoRows[i].locator('input[type="checkbox"]').first();
      await checkbox.click();
      console.log('Clicked checkbox');
      break;
    }
  }

  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/persona1-14.png', fullPage: true });
  console.log('URL:', p.url());

  await b.close();
})();
