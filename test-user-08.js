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

  // Scroll to make sure we can see the Emma item
  await p.evaluate(() => window.scrollBy(0, 300));
  await p.waitForTimeout(500);

  // Click the pencil icon for Emma dentist
  // The edit button coordinates (approximately from the screenshot)
  await p.mouse.click(259, 1092);

  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/persona1-08.png', fullPage: true });
  console.log('URL:', p.url());

  await b.close();
})();
