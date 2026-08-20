const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    console.log('=== TUESDAY MORNING - 20 MINUTES BEFORE CLIENT CALL ===');
    console.log('Current time: 9:40 AM. Call at 10:00 AM.');
    console.log('');

    // Open the app
    await p.goto('http://127.0.0.1:3455/');
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(500);

    // Sign in
    await p.fill('input[type="email"]', 'designer@example.com');
    await p.fill('input[type="password"]', 'freelancer2024');
    await p.click('button:has-text("Sign in")');
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(1000);

    console.log('App opened. Looking at the screen...');
    console.log('');

    // Take initial screenshot
    await p.screenshot({ path: '/tmp/p3-04-morning-view.png', fullPage: true });

    // Read what's on screen
    const pageText = await p.textContent('body');

    // Try to find what tasks are visible
    console.log('=== WHAT I SEE ON SCREEN ===');
    console.log('');

    // Check for "today" or current date tasks
    const todaySection = await p.locator('text=/Today|Thursday/').first();
    if (todaySection) {
      const text = await todaySection.textContent();
      console.log('Current section shows: ' + text.substring(0, 50));
    }

    // Get count of active todos
    const doneText = await p.locator('text=/of.*done/').textContent();
    console.log('Status: ' + doneText);
    console.log('');

    // Look for first few visible todos
    const todos = await p.locator('li[aria-busy="false"]').all();
    console.log(`Total visible todos: ${todos.length}`);
    console.log('First 5 visible items:');
    for (let i = 0; i < Math.min(5, todos.length); i++) {
      const text = await todos[i].textContent();
      // Extract just the title
      const titleMatch = text.match(/^(.*?)(Medium|High|Low)?$/);
      if (titleMatch) {
        console.log(`  ${i + 1}. ${titleMatch[1].trim()}`);
      }
    }

    console.log('');
    console.log('=== QUESTION 1: What does the app tell me to do first? ===');
    console.log('Looking at the UI... the first visible item in the list.');

    // Scroll to top to see what's actually first
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(300);
    await p.screenshot({ path: '/tmp/p3-04a-morning-top.png', fullPage: true });

    console.log('');
    console.log('=== QUESTION 2: Finding the three things that matter today ===');
    console.log('I need to look for items that might have "today" dates or high priority.');
    console.log('Let me search for things I should do now...');

    // Try searching for "today" or looking at filters
    const filterButtons = await p.locator('button:has-text("Active"), button:has-text("All")').all();
    console.log(`Found ${filterButtons.length} filter buttons`);

    // Let me look for any date indicators
    const dateElements = await p.locator('text=/today|tomorrow|monday|tuesday|august/i').all();
    console.log(`Found ${dateElements.length} date references on page`);

    console.log('');
    console.log('=== SCROLLING TO SEE THE FULL PICTURE ===');

    // Scroll to bottom to see if there's anything important there
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(300);
    await p.screenshot({ path: '/tmp/p3-04b-morning-bottom.png', fullPage: true });

    console.log('Scrolled to bottom of list.');

    console.log('');
    console.log('=== QUESTION 5: Can I search for something I know is in there? ===');
    console.log('Looking for search functionality...');

    // Try to find search box
    const searchBox = await p.$('input[placeholder*="Search"]');
    if (searchBox) {
      console.log('Found search box. Searching for "ABC Corp"...');
      await p.fill('input[placeholder*="Search"]', 'ABC Corp');
      await p.waitForTimeout(500);
      await p.screenshot({ path: '/tmp/p3-04c-search-result.png', fullPage: true });
    }

  } catch (e) {
    console.error('Error:', e.message);
    await p.screenshot({ path: '/tmp/p3-error.png', fullPage: true });
  } finally {
    await b.close();
  }
})();
