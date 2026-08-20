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

  // Try using JavaScript to click the checkbox directly
  await p.evaluate(() => {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    // The third checkbox (index 2) should be for "buy milk"
    if (checkboxes.length > 2) {
      checkboxes[2].click();
      console.log('Clicked checkbox via JS');
    }
  });

  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/persona1-15.png', fullPage: true });
  console.log('URL:', p.url());

  await b.close();
})();
