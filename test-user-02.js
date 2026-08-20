const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto('http://127.0.0.1:3455/sign-up');

  // Fill in the form
  await p.fill('input[placeholder="Ada Lovelace"]', 'Sarah Parker');
  await p.fill('input[placeholder="you@example.com"]', 'sparker@example.com');
  await p.fill('input[type="password"]', 'Kitchen2024!');

  // Click the create account button
  await p.click('button:has-text("Create account")');

  // Wait for navigation
  await p.waitForNavigation({ timeout: 5000 });

  await p.screenshot({ path: '/tmp/persona1-02.png', fullPage: true });
  console.log('Page title:', await p.title());
  console.log('URL:', p.url());
  await b.close();
})();
