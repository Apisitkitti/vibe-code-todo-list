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

  // Click on the "Emma dentist Thursday" item to see what options are available
  // I'll click the date icon for that item
  const todoItems = await p.locator('text=Emma dentist Thursday').all();
  if (todoItems.length > 0) {
    // Click near the date icon for this item
    const item = todoItems[0];
    const dateIcon = await item.locator('xpath=//*[name()="svg"][@aria-label="Calendar" or contains(@class, "calendar")]').first();

    // Try clicking the date icon
    try {
      await item.locator('button >> nth=0').click(); // The first button in the item (the date button)
    } catch (e) {
      console.log('Could not find date button, trying to click the item itself');
      await item.click();
    }
  }

  await p.waitForTimeout(1000);
  await p.screenshot({ path: '/tmp/persona1-06.png', fullPage: true });
  console.log('URL:', p.url());

  await b.close();
})();
