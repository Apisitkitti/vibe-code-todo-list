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

  // Now add the five items
  // Item 1: pick up dry cleaning
  await p.click('input[placeholder*="pay rent"]');
  await p.type('input[placeholder*="pay rent"]', 'pick up dry cleaning');
  await p.click('button:has-text("Add")');
  await p.waitForTimeout(600);

  // Item 2: Emma dentist Thursday
  await p.click('input[placeholder*="pay rent"]');
  await p.type('input[placeholder*="pay rent"]', 'Emma dentist Thursday');
  await p.click('button:has-text("Add")');
  await p.waitForTimeout(600);

  // Item 3: buy milk
  await p.click('input[placeholder*="pay rent"]');
  await p.type('input[placeholder*="pay rent"]', 'buy milk');
  await p.click('button:has-text("Add")');
  await p.waitForTimeout(600);

  // Item 4: pay electricity bill
  await p.click('input[placeholder*="pay rent"]');
  await p.type('input[placeholder*="pay rent"]', 'pay electricity bill');
  await p.click('button:has-text("Add")');
  await p.waitForTimeout(600);

  // Item 5: ask school about trip form
  await p.click('input[placeholder*="pay rent"]');
  await p.type('input[placeholder*="pay rent"]', 'ask school about trip form');
  await p.click('button:has-text("Add")');
  await p.waitForTimeout(1000);

  await p.screenshot({ path: '/tmp/persona1-05.png', fullPage: true });
  console.log('URL:', p.url());
  console.log('Title:', await p.title());

  await b.close();
})();
