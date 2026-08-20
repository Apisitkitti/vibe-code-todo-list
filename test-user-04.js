const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });

  // Go to sign-in page
  await p.goto('http://127.0.0.1:3455/sign-in');
  await p.waitForTimeout(1000);

  // Sign in
  await p.fill('input[type="email"]', 'sparker@example.com');
  await p.fill('input[type="password"]', 'Kitchen2024!');
  await p.click('button:has-text("Sign in")');

  // Wait for navigation to todos
  await p.waitForTimeout(2000);

  await p.screenshot({ path: '/tmp/persona1-04.png', fullPage: true });
  console.log('After sign-in - URL:', p.url());
  console.log('After sign-in - Title:', await p.title());

  await b.close();
})();
