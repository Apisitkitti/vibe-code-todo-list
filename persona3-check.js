const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    // Try to go to home - if we're logged in, we'll see the app
    await p.goto('http://127.0.0.1:3455/');
    await p.waitForLoadState('networkidle');

    console.log('Current URL:', p.url());
    await p.screenshot({ path: '/tmp/p3-check-home.png', fullPage: true });

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await b.close();
  }
})();
