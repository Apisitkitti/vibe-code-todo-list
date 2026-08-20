const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto('http://127.0.0.1:3455/sign-up');

  // Sign up
  await p.fill('input[placeholder="Ada Lovelace"]', 'Sarah Parker');
  await p.fill('input[placeholder="you@example.com"]', 'sparker@example.com');
  await p.fill('input[type="password"]', 'Kitchen2024!');
  await p.click('button:has-text("Create account")');

  // Wait for the button to be gone or disabled, indicating submission
  await p.waitForTimeout(2000);

  // Now I'm on the todos page - wait for the input to be visible
  await p.waitForSelector('input[placeholder*="try"]', { timeout: 10000 });

  await p.waitForTimeout(1000);

  // Add first todo: "pick up dry cleaning"
  const input = await p.$('input[placeholder*="try"]');
  await input.click();
  await p.type('input[placeholder*="try"]', 'pick up dry cleaning');
  await p.click('button:has-text("Add")');

  await p.waitForTimeout(500);

  // Add second todo: "Emma's dentist Thursday"
  await p.fill('input[placeholder*="try"]', 'Emma dentist Thursday');
  await p.click('button:has-text("Add")');

  await p.waitForTimeout(500);

  // Add third todo: "buy milk"
  await p.fill('input[placeholder*="try"]', 'buy milk');
  await p.click('button:has-text("Add")');

  await p.waitForTimeout(500);

  // Add fourth todo: "pay electricity bill"
  await p.fill('input[placeholder*="try"]', 'pay electricity bill');
  await p.click('button:has-text("Add")');

  await p.waitForTimeout(500);

  // Add fifth todo: "ask school about trip form"
  await p.fill('input[placeholder*="try"]', 'ask school about trip form');
  await p.click('button:has-text("Add")');

  await p.waitForTimeout(1500);

  await p.screenshot({ path: '/tmp/persona1-03.png', fullPage: true });
  console.log('Page title:', await p.title());
  console.log('URL:', p.url());
  await b.close();
})();
