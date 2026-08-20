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

  // Wait and take screenshot
  await p.waitForTimeout(3000);

  await p.screenshot({ path: '/tmp/debug-01.png', fullPage: true });
  console.log('After sign-up - URL:', p.url());
  console.log('After sign-up - Title:', await p.title());

  await b.close();
})();
