import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { deleteTestAccount, disconnectDatabase } from "./database";
import {
  ADD_TODO_LABEL,
  CREATE_ACCOUNT_LABEL,
  DELETE_CONFIRM_ACTION,
  NEW_TODO_LABEL,
  PAGE_HEADING,
  SAVE_CHANGES_LABEL,
  TITLE_FIELD_LABEL,
  UNDO_LABEL,
  deleteLabel,
  editLabel,
  markCompleteLabel,
  markNotCompleteLabel,
} from "./copy";

/**
 * Per-test isolation and the helpers every spec shares.
 *
 * Isolation is by account, not by database: the suite runs against the real
 * Neon instance, so a test may only ever see rows it created itself. Each test
 * signs up a brand-new account through the UI, does its work inside that
 * account, and deletes it afterwards. Two tests can therefore never observe
 * each other's todos, and no test can observe production data — `GET
 * /api/todos` is scoped to `session.user.id` in the handler.
 */

/** RFC 2606 reserved TLD — see the bound described in `./database.ts`. */
const EMAIL_DOMAIN = "e2e.invalid";
const PASSWORD = "e2e-playwright-pw";

/**
 * One id per Playwright process, so every address this run generates shares a
 * segment that no other run — and nothing in production — can collide with.
 * Lowercase alphanumerics only, to satisfy the teardown guard's pattern.
 */
const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let accountIndex = 0;

export interface TestAccount {
  name: string;
  email: string;
  password: string;
}

const createAccountDetails = (): TestAccount => {
  accountIndex += 1;

  return {
    name: "E2E Runner",
    email: `e2e-${RUN_ID}-${accountIndex}@${EMAIL_DOMAIN}`,
    password: PASSWORD,
  };
};

/**
 * Locators and actions for the todos screen.
 *
 * Every locator is role- or label-based and comes from the copy deck, so a
 * wording change fails these tests loudly instead of silently matching
 * nothing — which is the failure mode a CSS-class selector would have.
 */
export interface TodosScreen {
  toasts: Locator;
  toastTitles: Locator;
  undoButton: Locator;
  confirmDialog: Locator;
  listSkeleton: Locator;
  row: (title: string) => Locator;
  rowByText: (title: string) => Locator;
  checkbox: (title: string) => Locator;
  editButton: (title: string) => Locator;
  deleteButton: (title: string) => Locator;
  openCreate: () => Promise<void>;
  submitCreate: (title: string) => Promise<void>;
  createTodo: (title: string) => Promise<void>;
  openEdit: (title: string) => Promise<void>;
  submitEdit: (nextTitle: string) => Promise<void>;
  editTodo: (title: string, nextTitle: string) => Promise<void>;
  toggle: (title: string, complete: boolean) => Promise<void>;
  openDelete: (title: string) => Promise<void>;
  confirmDelete: () => Promise<void>;
  pressUndo: () => Promise<void>;
}

const titleField = (page: Page) => page.getByRole("textbox", { name: TITLE_FIELD_LABEL });

/**
 * Waits until no toast view transition is in flight.
 *
 * HeroUI runs *every* toast add and close inside `document.startViewTransition`
 * and chains them so they animate one at a time
 * (`node_modules/@heroui/react/dist/components/toast/toast-queue.js`). While
 * one is running the browser paints the `::view-transition` snapshot layer over
 * the page, and that layer — not the live DOM — is what hit-testing sees. A
 * pointer press aimed at the Undo button therefore lands on the overlay,
 * react-aria's `usePress` never fires, and the press is silently dropped: no
 * dismissal, no request, no follow-up toast.
 *
 * The trap is that a toast is *visible* the moment its transition starts, so
 * every web-first assertion the specs already make ("the toast title is
 * visible") is satisfied while the toast is still inert. Visible is not
 * pressable, and only this closes that gap. Anything that raises or replaces a
 * toast starts a fresh transition, which is why the two specs that press Undo
 * straight after a toast *replacement* — close + add, two chained transitions —
 * are the ones that broke on a runner slow enough to still be animating.
 *
 * NOT a sleep and not a retry: it waits on the animation state itself. The two
 * quiet frames are required because the chain releases the DOM between links,
 * so a single idle sample can land in the gap between the close and the add and
 * report calm that is about to end — which is exactly how the click's own
 * built-in hit-target check was fooled on CI.
 */
const settleToastTransitions = async (page: Page) => {
  await page.evaluate(async () => {
    const isTransitioning = () =>
      document.getAnimations().some((animation) => {
        const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;

        return (
          animation.playState === "running" &&
          pseudo?.startsWith("::view-transition") === true
        );
      });

    const nextFrame = () =>
      new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    /*
      Bounded so a page that animates forever fails as the assertion it was
      always going to fail, rather than hanging until the test timeout with
      nothing to read. At 60fps this is ~5s, far longer than a toast chain.
    */
    const MAX_FRAMES = 300;

    /*
      Three, not two. HeroUI chains a close and an add through
      `startViewTransition`, and the gap between two chained transitions is
      two idle frames — measured at 2 frames across 4 runs in this project's
      own Chromium. Two quiet frames therefore returns *inside* that seam,
      with the next transition starting on the following frame; three clears
      the whole chain. This is the difference between waiting for the
      animation to finish and finding the one gap in the middle of it.
    */
    const QUIET_FRAMES = 3;

    let quiet = 0;

    for (let frame = 0; frame < MAX_FRAMES && quiet < QUIET_FRAMES; frame += 1) {
      await nextFrame();

      quiet = isTransitioning() ? 0 : quiet + 1;
    }
  });
};

export const createTodosScreen = (page: Page): TodosScreen => {
  /*
    HeroUI renders every toast through react-aria's Toast primitive and stamps
    `data-slot` on each part (`node_modules/@heroui/react/dist/components/toast`).
    These are the library's own contract attributes, not styling hooks, so they
    are stable to assert against in a way a Tailwind class is not.
  */
  const toasts = page.locator('[data-slot="toast"]');
  const toastTitles = page.locator('[data-slot="toast-title"]');
  const undoButton = page.locator('[data-slot="toast-action-button"]', {
    hasText: UNDO_LABEL,
  });

  /*
    Not `getByRole("alertdialog")`: react-aria gives *toasts* that role too
    (with `aria-modal="false"`), so the role alone matches every visible toast
    as well as the confirm. The dialog's own `data-slot` is the only
    unambiguous handle.
  */
  const confirmDialog = page.locator('[data-slot="alert-dialog-dialog"]');
  const listSkeleton = page.getByLabel("Loading todos");

  /*
    Scoped to `<main>`. The toast region is itself a list of `<li>`s carrying
    the todo title, so an unscoped `getByRole("listitem")` matches both the row
    and its own success toast and trips strict mode. `Toast.Provider` is
    mounted in the root layout's `<body>`, outside `<main>`, so this is the
    boundary between the two.
  */
  const rowByText = (title: string) =>
    page.locator("main").getByRole("listitem").filter({ hasText: title });

  const checkbox = (title: string) =>
    page
      .getByRole("checkbox", { name: markCompleteLabel(title) })
      .or(page.getByRole("checkbox", { name: markNotCompleteLabel(title) }));

  const editButton = (title: string) =>
    page.getByRole("button", { name: editLabel(title), exact: true });

  const deleteButton = (title: string) =>
    page.getByRole("button", { name: deleteLabel(title), exact: true });

  const openCreate = async () => {
    await page.getByRole("button", { name: NEW_TODO_LABEL, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  };

  const submitCreate = async (title: string) => {
    await titleField(page).fill(title);
    await page.getByRole("button", { name: ADD_TODO_LABEL, exact: true }).click();
  };

  const createTodo = async (title: string) => {
    await openCreate();
    await submitCreate(title);
    await expect(rowByText(title)).toBeVisible();
  };

  const openEdit = async (title: string) => {
    /*
      The row's actions are `lg:opacity-0` until hover or focus-within. They
      occupy layout the whole time, so they are clickable without hovering —
      but hovering first is what a user does, and it keeps this helper honest
      at desktop width.
    */
    await rowByText(title).hover();
    await editButton(title).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  };

  const submitEdit = async (nextTitle: string) => {
    await titleField(page).fill(nextTitle);
    await page.getByRole("button", { name: SAVE_CHANGES_LABEL, exact: true }).click();
  };

  const editTodo = async (title: string, nextTitle: string) => {
    await openEdit(title);
    await submitEdit(nextTitle);
  };

  /**
   * Clicks the visible control, not the input.
   *
   * react-aria renders the real `<input type="checkbox">` visually hidden
   * underneath a styled `<span data-slot="checkbox-control">`, so a click
   * aimed at the input is intercepted by that span — Playwright reports it as
   * "intercepts pointer events" and retries until it times out. The span is
   * what a user actually clicks, and it sits inside the `<label>`, so clicking
   * it drives the input exactly the way a real interaction does.
   *
   * `complete` names the state being asserted *before* the click, which is how
   * the `aria-label` reads (§7.4): an incomplete todo is labelled "Mark … as
   * complete".
   */
  const toggle = async (title: string, complete: boolean) => {
    const label = complete ? markCompleteLabel(title) : markNotCompleteLabel(title);

    // Anchored to the labelled input so this cannot drift to another row.
    await expect(page.getByRole("checkbox", { name: label })).toBeVisible();
    await rowByText(title).locator('[data-slot="checkbox-control"]').click();
  };

  const openDelete = async (title: string) => {
    await rowByText(title).hover();
    await deleteButton(title).click();
    await expect(confirmDialog).toBeVisible();
  };

  const confirmDelete = async () => {
    await confirmDialog
      .getByRole("button", { name: DELETE_CONFIRM_ACTION, exact: true })
      .click();
  };

  const pressUndo = async () => {
    await settleToastTransitions(page);
    await undoButton.click();
  };

  return {
    toasts,
    toastTitles,
    undoButton,
    confirmDialog,
    listSkeleton,
    row: rowByText,
    rowByText,
    checkbox,
    editButton,
    deleteButton,
    openCreate,
    submitCreate,
    createTodo,
    openEdit,
    submitEdit,
    editTodo,
    toggle,
    openDelete,
    confirmDelete,
    pressUndo,
  };
};

/** Signs up through the UI and waits for the todos screen to be ready. */
export const signUp = async (page: Page, account: TestAccount): Promise<void> => {
  await page.goto("/sign-up");

  await page.getByRole("textbox", { name: "Name" }).fill(account.name);
  await page.getByRole("textbox", { name: "Email" }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: CREATE_ACCOUNT_LABEL, exact: true }).click();

  await expect(page.getByRole("heading", { name: PAGE_HEADING })).toBeVisible();
};

export interface AppFixtures {
  /** A fresh account, deleted after the test whether it passed or failed. */
  account: TestAccount;
  /** A page already signed in to `account`, sitting on `/todos`. */
  signedIn: Page;
  todos: TodosScreen;
}

/*
  Playwright's second fixture argument is positional, so it is named `provide`
  here rather than the customary `use`. `eslint-plugin-react-hooks` treats a
  call to anything named `use` as React's `use` hook and fails the file with
  `rules-of-hooks`; renaming the parameter fixes that at the call site instead
  of loosening the shared ESLint config, which this branch does not own.
*/
export const test = base.extend<AppFixtures>({
  account: async ({}, provide) => {
    const account = createAccountDetails();

    await provide(account);

    // Runs even when the test failed, so a red run does not leak accounts.
    await deleteTestAccount(account.email);
  },

  signedIn: async ({ page, account }, provide) => {
    await signUp(page, account);

    await provide(page);
  },

  /*
    Depends on `signedIn`, so a test that asks only for `todos` is still signed
    in to its own fresh account. That keeps the common case to a single fixture
    and stops specs from having to name a `page` they never touch.
  */
  todos: async ({ signedIn }, provide) => {
    await provide(createTodosScreen(signedIn));
  },
});

test.afterAll(async () => {
  await disconnectDatabase();
});

export { expect };
