const { chromium } = require('playwright');

async function addTodo(page, title, date = null, priority = null) {
  // Click the add button or shortcut
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(300);

  // Type the title
  await page.type('input[placeholder*="New"]', title);

  // Add date if specified
  if (date) {
    // This would require more interaction - for now skip dates
  }

  // Submit
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const startTime = Date.now();

  try {
    // Sign in
    await p.goto('http://127.0.0.1:3455/');
    await p.waitForLoadState('networkidle');

    // Fill signin form
    const emailField = await p.$('input[type="email"]');
    if (emailField) {
      await p.fill('input[type="email"]', 'designer@example.com');
      await p.fill('input[type="password"]', 'freelancer2024');
      await p.click('button:has-text("Sign in")');
      await p.waitForLoadState('networkidle');
    }

    // Wait for app to load
    await p.waitForTimeout(1000);

    console.log('Starting to add todos...');

    // Build a realistic freelancer's month of work
    const todos = [
      // High-priority client work with deadlines
      { title: 'Finalize designs for ABC Corp website', priority: 1, daysOffset: 0 },
      { title: 'Client review call - ABC Corp', priority: 1, daysOffset: 1 },
      { title: 'Revise homepage based on feedback', priority: 1, daysOffset: 3 },
      { title: 'Create user flows for checkout', priority: 1, daysOffset: 2 },
      { title: 'Design system documentation', priority: 2, daysOffset: 5 },

      // Admin and other clients
      { title: 'Invoice client XYZ for August', priority: 2, daysOffset: 0 },
      { title: 'Follow up on XYZ payment', priority: 2, daysOffset: -7 }, // overdue
      { title: 'Update portfolio with latest project', priority: 2, daysOffset: 7 },
      { title: 'Review contract for new client', priority: 1, daysOffset: -3 }, // overdue
      { title: 'Send quote to Design Collective', priority: 2, daysOffset: 2 },

      // Personal and household
      { title: 'Dentist appointment', priority: 2, daysOffset: -5 }, // overdue
      { title: 'Pay rent', priority: 1, daysOffset: 0 },
      { title: 'Grocery shopping', priority: 2, daysOffset: 0 },
      { title: 'Car insurance renewal - email them', priority: 2, daysOffset: -10 }, // very overdue
      { title: 'Fix desk lamp', priority: 3, daysOffset: 10 },

      // Ongoing projects
      { title: 'Design mobile app mockups', priority: 1, daysOffset: 4 },
      { title: 'Client feedback: color palette iterations', priority: 2, daysOffset: 1 },
      { title: 'Slack: respond to team messages', priority: 2, daysOffset: 0 },
      { title: 'Test designs on phone', priority: 2, daysOffset: 2 },
      { title: 'Organize project files', priority: 3, daysOffset: 14 },

      // Vague someday things
      { title: 'Learn new design tool', priority: 3, daysOffset: null },
      { title: 'Rebrand personal site', priority: 3, daysOffset: null },
      { title: 'Write blog post about design process', priority: 3, daysOffset: null },
      { title: 'Attend design conference', priority: 3, daysOffset: null },

      // More client work
      { title: 'Research competitor designs', priority: 1, daysOffset: 3 },
      { title: 'Pitch new service offerings to past clients', priority: 2, daysOffset: 7 },
      { title: 'Create marketing materials for services', priority: 2, daysOffset: 10 },
      { title: 'Update LinkedIn profile', priority: 3, daysOffset: 21 },

      // More admin
      { title: 'Backup design files to cloud', priority: 2, daysOffset: -2 }, // overdue
      { title: 'Clean up old project folders', priority: 3, daysOffset: 14 },
      { title: 'Order new mouse - it\'s dying', priority: 2, daysOffset: 3 },
      { title: 'Review and update rates for 2025', priority: 2, daysOffset: 14 },

      // More personal
      { title: 'Book haircut appointment', priority: 3, daysOffset: 5 },
      { title: 'Return package to Amazon', priority: 2, daysOffset: -1 }, // overdue
      { title: 'Call mom', priority: 2, daysOffset: 0 },
      { title: 'Plan weekend trip', priority: 3, daysOffset: 4 },

      // More work tasks
      { title: 'Set up calls with 3 potential clients', priority: 1, daysOffset: 5 },
      { title: 'Create proposal document template', priority: 2, daysOffset: 10 },
      { title: 'Respond to portfolio inquiries', priority: 1, daysOffset: 0 },
      { title: 'Update case study with latest metrics', priority: 2, daysOffset: 7 },
      { title: 'Attend team standup', priority: 2, daysOffset: 0 },
      { title: 'Sign NDA for consulting gig', priority: 1, daysOffset: 1 },
      { title: 'Scope work for consulting gig', priority: 1, daysOffset: 2 },
      { title: 'Prepare designs for handoff to dev', priority: 1, daysOffset: 1 },
    ];

    // Create most todos
    console.time('adding-todos');
    for (let i = 0; i < todos.length; i++) {
      const todo = todos[i];
      try {
        // Focus on title input field
        const titleInput = await p.$('input[placeholder*="New"], input[placeholder*="Add"], input[type="text"]');
        if (!titleInput) {
          console.log(`Todo ${i + 1}: Could not find input field, trying modal...`);
          await p.keyboard.press('KeyN');
          await p.waitForTimeout(300);
        }

        // Type the title
        await p.type('input[type="text"]', todo.title);

        // Submit
        await p.keyboard.press('Enter');
        await p.waitForTimeout(150);

        if ((i + 1) % 10 === 0) {
          console.log(`Added ${i + 1}/${todos.length} todos...`);
        }
      } catch (e) {
        console.log(`Error adding todo ${i + 1} (${todo.title}): ${e.message}`);
      }
    }
    console.timeEnd('adding-todos');

    const addingTime = Date.now() - startTime;
    console.log(`Finished adding todos in ${Math.round(addingTime / 1000)} seconds`);

    await p.screenshot({ path: '/tmp/p3-02-todos-added.png', fullPage: true });

  } catch (e) {
    console.error('Fatal error:', e.message);
    await p.screenshot({ path: '/tmp/p3-error.png', fullPage: true });
  } finally {
    await b.close();
  }
})();
