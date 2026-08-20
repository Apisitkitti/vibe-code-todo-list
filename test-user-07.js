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

  // Find all todo items with buttons
  const allButtons = await p.locator('button').all();
  console.log(`Found ${allButtons.length} buttons total`);

  // Get all text content to understand the page structure
  const pageText = await p.textContent('body');
  if (pageText.includes('Emma dentist Thursday')) {
    console.log('Found Emma dentist Thursday');
  }

  // Try clicking with a more direct approach - find the edit button near Emma text
  // The edit button should be the one with a pencil icon
  const emmaSection = await p.locator(':has-text("Emma dentist Thursday")').first();

  // Find the parent container
  const parent = emmaSection.locator('xpath=ancestor::div[1]');

  // Get all buttons in this parent
  const buttonsInParent = await parent.locator('button').all();
  console.log(`Found ${buttonsInParent.length} buttons in Emma item`);

  // The buttons should be: calendar, edit, delete
  // So the edit button should be the second one (index 1)
  if (buttonsInParent.length >= 2) {
    console.log('Clicking edit button');
    await buttonsInParent[1].click();
  }

  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/persona1-07.png', fullPage: true });
  console.log('URL:', p.url());

  await b.close();
})();
