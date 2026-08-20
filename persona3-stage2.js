const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    // Sign in
    await p.goto('http://127.0.0.1:3455/');
    await p.waitForLoadState('networkidle');

    // Fill signin form
    await p.fill('input[type="email"]', 'designer@example.com');
    await p.fill('input[type="password"]', 'freelancer2024');
    await p.click('button:has-text("Sign in")');
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(1000);

    // Get all the todo items and mark them complete using labels
    const todoItems = await p.locator('li[aria-busy="false"]').all();
    console.log(`Found ${todoItems.length} todo items`);

    // Mark about 15 todos as complete by clicking on the todo item's click area
    const toComplete = 15;
    let completed = 0;

    for (let i = 0; i < Math.min(toComplete, todoItems.length); i++) {
      try {
        // Try to force-click the checkbox within the item
        const item = todoItems[i];
        const checkbox = await item.locator('input[type="checkbox"]');

        // Try using force click
        await checkbox.click({ force: true });
        completed++;

        await p.waitForTimeout(150);

        if ((completed) % 5 === 0) {
          console.log(`Completed ${completed}/${toComplete} todos...`);
        }
      } catch (e) {
        console.log(`Could not complete todo ${i}: ${e.message.substring(0, 80)}`);
      }
    }

    console.log(`Marked ${completed} todos as complete`);
    await p.waitForTimeout(500);
    await p.screenshot({ path: '/tmp/p3-03-after-completing.png', fullPage: true });

  } catch (e) {
    console.error('Error:', e.message);
    await p.screenshot({ path: '/tmp/p3-error.png', fullPage: true });
  } finally {
    await b.close();
  }
})();
