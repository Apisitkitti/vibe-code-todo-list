const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto('http://127.0.0.1:3455/sign-up');
  await p.screenshot({ path: '/tmp/persona1-01.png', fullPage: true });
  console.log('Page title:', await p.title());
  console.log('URL:', p.url());
  await b.close();
})();
