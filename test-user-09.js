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

  // Let me try to use keyboard navigation instead
  // First, scroll to Emma item
  await p.evaluate(() => {
    const emmaElement = Array.from(document.querySelectorAll('*'))
      .find(el => el.textContent.includes('Emma dentist Thursday'));
    if (emmaElement) {
      emmaElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  await p.waitForTimeout(1000);

  // Now try to find and click the edit button next to Emma
  // Looking for svg that might be in the edit button
  const editButtons = await p.locator('button svg').all();
  console.log(`Found ${editButtons.length} icon buttons`);

  // Try clicking on the text itself to see if that selects it
  await p.click('text=Emma dentist Thursday');

  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/persona1-09.png', fullPage: true });
  console.log('URL:', p.url());

  await b.close();
})();
