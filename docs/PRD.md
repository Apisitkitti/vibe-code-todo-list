# PRD — Personal Todo App (v1)

Status: draft for build
Owner: Product Owner
Related docs: `docs/STACK.md` (tech stack & constraints), `prisma/schema.prisma` (fixed data model)

---

## 1. Product summary

A personal todo web app with individual accounts. A user signs up with a name, email, and password, signs in, and manages a private list of todos that nobody else can see or modify. Each todo has a required title and optional note, priority (low/medium/high), and due date; todos can be completed, edited, deleted, and filtered by status and priority. v1 is deliberately single-user-per-list: there is no sharing, no collaboration, and no social login — just a fast, accessible, mobile-first list that works in light and dark mode.

---

## 2. Definitions

- **Session user** — the user identified by the current better-auth session cookie.
- **Active todo** — a todo with `completed = false`.
- **Completed todo** — a todo with `completed = true`.
- **Protected route** — any route under the app shell that renders or mutates todo data.
- **Auth routes** — `/sign-up` and `/sign-in`.
- **Default list order** — active todos before completed todos; within each group, `createdAt` descending (newest first).

Fixed field constraints from the schema (not negotiable):

| Field | Type | Rule |
|---|---|---|
| `title` | String | required, non-empty after trim, max 200 chars |
| `note` | String? | optional, max 2000 chars |
| `priority` | enum | one of `low`, `medium`, `high`; defaults to `medium` |
| `completed` | Boolean | defaults to `false` |
| `dueAt` | DateTime? | optional; any date, past dates allowed |
| `userId` | String | always the session user's id, never client-supplied |

---

## 3. User stories

### US-01 — Sign up with email and password

As a new visitor, I want to create an account with my name, email, and password, so that I have a private place to keep my todos.

**Acceptance criteria**

- Given I am on `/sign-up`, When the page loads, Then I see fields for Name, Email, Password, and a "Create account" submit button, plus a link to `/sign-in`.
- Given I enter name "Ada", a valid unused email, and a password of at least 8 characters, When I submit, Then an account is created, I am signed in, and I am redirected to `/todos`.
- Given I leave Name, Email, or Password empty, When I submit, Then the form does not submit and each empty field shows an inline "required" error message.
- Given I enter a password of 7 characters or fewer, When I submit, Then no account is created and I see the inline error "Password must be at least 8 characters".
- Given I enter a string with no `@` (e.g. `not-an-email`), When I submit, Then no account is created and I see the inline error "Enter a valid email address".
- Given an account already exists with the email I entered, When I submit, Then no second account is created and I see the error "An account with this email already exists"; the Password field is cleared and the Email field keeps its value.
- Given the form is submitting, When I press the submit button again, Then the button is disabled and only one account-creation request is sent.
- Given my account was just created, When I inspect the stored record, Then `emailVerified` is `false` and I am still able to use the app (email verification is not required in v1).

### US-02 — Sign in

As a returning user, I want to sign in with my email and password, so that I can reach my own todos.

**Acceptance criteria**

- Given I am on `/sign-in`, When the page loads, Then I see Email, Password, a "Sign in" button, and a link to `/sign-up`.
- Given I submit the correct email and password for an existing account, When the request succeeds, Then a session is created and I am redirected to `/todos`.
- Given I submit a correct email with a wrong password, When the request completes, Then I remain on `/sign-in` and see the error "Invalid email or password".
- Given I submit an email that has no account, When the request completes, Then I see the same message "Invalid email or password" (no hint that the account does not exist).
- Given I was redirected to `/sign-in` from a protected route (e.g. `/todos`), When I sign in successfully, Then I land on the route I originally requested.
- Given I already have a valid session, When I navigate to `/sign-in` or `/sign-up`, Then I am redirected to `/todos` without seeing the form.

### US-03 — Sign out

As a signed-in user, I want to sign out, so that my todos are not visible to anyone else using this device.

**Acceptance criteria**

- Given I am signed in, When I open the account menu in the header, Then I see my name or email and a "Sign out" item.
- Given I click "Sign out", When the request completes, Then my session is destroyed, the session cookie is cleared, and I am redirected to `/sign-in`.
- Given I have signed out, When I press the browser Back button to return to `/todos`, Then I am redirected to `/sign-in` and no todo data is rendered.

### US-04 — Protected routes

As a user, I want the app to require authentication, so that nobody can reach my todos without signing in.

**Acceptance criteria**

- Given I have no session, When I request `/todos` or any sub-route of the app shell, Then I am redirected to `/sign-in` and no todo data is included in the response.
- Given I have no session, When the redirect happens, Then the originally requested path is preserved (e.g. `/sign-in?next=/todos`) and used after a successful sign-in.
- Given my session cookie is expired or invalid, When I request a protected route, Then I am treated as unauthenticated and redirected to `/sign-in`.
- Given I have no session, When I call any todo mutation endpoint/server action directly, Then it fails with an unauthorized error and performs no database write.
- Given I am signed in as User A, When a request tries to read or mutate a todo whose `userId` is User B, Then the operation returns not-found and no data from User B is exposed or changed.

### US-05 — Create a todo

As a signed-in user, I want to add a todo with a title and optional details, so that I can capture what I need to do.

**Acceptance criteria**

- Given I am on `/todos`, When the page loads, Then I see a create form (or a button that opens one) with Title, Note, Priority, and Due date fields.
- Given I enter a title "Buy milk" and submit with all other fields untouched, When the request succeeds, Then a todo is created with `title = "Buy milk"`, `note = null`, `priority = medium`, `completed = false`, `dueAt = null`, and `userId` = my id, and it appears at the top of the list without a full page reload.
- Given the Title field is empty or only whitespace, When I submit, Then no todo is created and I see the inline error "Title is required".
- Given I enter a title longer than 200 characters, When I submit, Then no todo is created and I see the inline error "Title must be 200 characters or fewer".
- Given I enter a note longer than 2000 characters, When I submit, Then no todo is created and I see the inline error "Note must be 2000 characters or fewer".
- Given I select priority "high" and a due date, When I submit, Then the created todo stores that priority and due date and both are visible on the todo row.
- Given the todo was created successfully, When the list updates, Then the create form is reset to its defaults (empty title, empty note, priority `medium`, no due date).
- Given the create request fails (server or network error), When the failure is returned, Then my typed values remain in the form and I see an error message telling me the todo was not saved.

### US-06 — List todos

As a signed-in user, I want to see all of my todos in one list, so that I know what is outstanding.

**Acceptance criteria**

- Given I have todos, When I open `/todos`, Then I see only todos where `userId` equals my id.
- Given another user has todos, When I open `/todos`, Then none of their todos appear in my list under any filter.
- Given I have both active and completed todos, When the list renders with no filter applied, Then active todos appear before completed todos, and within each group newest-created appears first.
- Given a todo row renders, When I look at it, Then I see its title, a completion control, its priority, its due date if set, and an indicator that a note exists if `note` is non-empty.
- Given a todo is completed, When it renders, Then its title is visually de-emphasised (e.g. strikethrough) and this is not conveyed by color alone.
- Given the list is loading, When data has not arrived, Then a loading state (skeleton or spinner) is shown rather than a blank screen.

### US-07 — Toggle a todo complete/incomplete

As a signed-in user, I want to check off a todo, so that I can track what I finished.

**Acceptance criteria**

- Given an active todo, When I activate its completion control, Then `completed` becomes `true`, the row shows the completed styling, and the change persists after a page reload.
- Given a completed todo, When I activate its completion control again, Then `completed` becomes `false` and it returns to the active group.
- Given the "All" filter is active, When I toggle a todo, Then it moves between the active and completed groups in the default order without a full page reload.
- Given the "Active" filter is applied, When I mark a visible todo complete, Then it disappears from the filtered list.
- Given the toggle request fails, When the error returns, Then the control reverts to its previous state and an error message is shown.
- Given I toggle a todo, When the request is sent, Then only the todo's `completed` value changes — title, note, priority, and due date are unchanged.

### US-08 — Edit a todo

As a signed-in user, I want to edit an existing todo, so that I can correct or refine it.

**Acceptance criteria**

- Given a todo in my list, When I activate its Edit control, Then an edit form opens pre-filled with the todo's current title, note, priority, and due date.
- Given I change the title to a valid non-empty value and save, When the request succeeds, Then the row shows the new values and the change persists after reload.
- Given I clear the title and save, When I submit, Then no update is made and I see the inline error "Title is required".
- Given I clear the note or the due date and save, When the request succeeds, Then `note` / `dueAt` are stored as `null` and the row no longer shows them.
- Given I change values and then cancel, When the form closes, Then the todo is unchanged.
- Given the same title/note length rules as US-05, When I exceed them, Then the update is rejected with the same inline error messages.
- Given I edit a todo, When the update runs, Then it is scoped by both `id` and my `userId`, and an id belonging to another user returns not-found.

### US-09 — Delete a todo (with confirmation)

As a signed-in user, I want to delete a todo behind a confirmation step, so that I can remove clutter without deleting things by accident.

**Acceptance criteria**

- Given a todo row, When I activate its Delete control, Then a confirmation dialog appears naming the todo's title, with "Delete" and "Cancel" actions, and nothing is deleted yet.
- Given the confirmation dialog is open, When I choose "Cancel" or press Escape, Then the dialog closes and the todo still exists.
- Given the confirmation dialog is open, When I choose "Delete", Then the todo is removed from the database, disappears from the list without a full page reload, and stays gone after a reload.
- Given the confirmation dialog is open, When it receives focus, Then focus is trapped inside it and returns to the triggering control after it closes.
- Given the delete request fails, When the error returns, Then the todo remains in the list and an error message is shown.
- Given I delete a todo, When the delete runs, Then it is scoped by both `id` and my `userId`; deleting was my last todo means the empty state (US-11) is shown.

### US-10 — Filter todos by status and priority

As a signed-in user, I want to filter my list by status and priority, so that I can focus on what matters now.

**Acceptance criteria**

- Given I am on `/todos`, When the page loads, Then the status filter defaults to "All" and the priority filter defaults to "All priorities".
- Given the status filter, When I select "Active", Then only todos with `completed = false` are listed; When I select "Completed", Then only todos with `completed = true` are listed; When I select "All", Then both are listed.
- Given the priority filter, When I select "High", Then only todos with `priority = high` are listed; the same holds for "Medium" and "Low".
- Given I set status "Active" and priority "High", When the list renders, Then it shows only todos that are both active and high priority (filters combine with AND).
- Given filters are applied, When I reload the page, Then the same filter selection is still applied (filter state is reflected in the URL).
- Given a filter combination matches no todos while I do have todos, When the list renders, Then I see a "No todos match these filters" message with a control to clear the filters, and clearing restores the full list.
- Given any filter is applied, When results render, Then they still contain only my own todos.

### US-11 — Empty state

As a new signed-in user with no todos, I want a clear empty state, so that I know the app works and what to do first.

**Acceptance criteria**

- Given I have zero todos, When I open `/todos`, Then I see an empty state with a short heading, one line of guidance, and a call to action to add my first todo — and no filter chrome implying missing data.
- Given the empty state is shown, When I activate its call to action, Then the create-todo form opens/focuses the Title field.
- Given I create my first todo, When the list updates, Then the empty state is replaced by the list containing that todo.
- Given I delete my only remaining todo, When the list updates, Then the empty state reappears.
- Given I have zero todos, When the empty state renders, Then it is visually distinct from the "no todos match these filters" message in US-10.

---

## 4. Scope boundaries

### In scope for v1

- Email + password sign-up (name, email, password), sign-in, sign-out via better-auth.
- Session-cookie authentication; all app routes protected, unauthenticated users redirected to sign-in.
- Create, read, update, delete todos, scoped to the session user.
- Todo fields exactly as in the schema: title, note, priority, completed, dueAt.
- Toggle complete/incomplete.
- Delete with a confirmation dialog.
- Filter by status (all/active/completed) and by priority (all/low/medium/high), combinable, reflected in the URL.
- Text search over the todo list, combinable with the filters and reflected in the URL.
- Undo on the completion toggle, offered from its toast. Toggling is the one
  mutation with no confirmation dialog, so undo is what makes it reversible;
  it re-runs the same scoped endpoint rather than taking a shortcut.
- Empty state and no-results state.
- Responsive mobile-first layout, dark mode, keyboard accessibility.

### Out of scope for v1

- Social / OAuth login (Google, GitHub, Apple, etc.).
- Teams, workspaces, sharing todos, or any multi-user collaboration.
- Sub-tasks / checklists inside a todo.
- Tags, labels, categories, or projects.
- Recurring todos and repeat schedules.
- Notifications of any kind: email, push, in-app reminders, due-date alerts.
- File or image attachments.
- Email verification flow, password reset / forgot password, and account deletion.
- Profile editing (name, avatar, password change).
- Sorting controls, drag-and-drop reordering, and pagination or infinite scroll.
- Bulk actions (complete all, delete all, clear completed).
- Trash / archive / soft delete.
- Offline support, PWA install, native apps.
- Calendar view, analytics, streaks, or any reporting.
- Public API, data import/export, third-party integrations.
- Internationalisation — English only.

---

## 5. Non-functional requirements

**NFR-01 — Per-user authorization (core rule).** Every database read and write touching `Todo` includes `userId` = the session user's id in its `where` clause. `userId` is never taken from client input; it is resolved server-side from the session. A request for a todo id that belongs to another user returns not-found (never another user's data, never a 403 that confirms existence).

**NFR-02 — Server-side auth checks.** Authentication and ownership are enforced on the server for every mutation and data fetch. Hiding a UI control is never the only protection; a direct request to a mutation with no session or with a foreign todo id must fail without writing.

**NFR-03 — Password policy.** Passwords are a minimum of 8 characters. The rule is enforced both client-side (inline error before submit) and server-side (rejected even if the client check is bypassed). Passwords are stored only as hashes by better-auth, are never logged, and are never returned in any response.

**NFR-04 — Keyboard accessibility.** Every interactive element (links, buttons, inputs, selects, filters, completion toggles, edit and delete controls, dialog actions) is reachable and operable by keyboard alone, in a logical tab order, with a visible focus indicator. Dialogs trap focus, close on Escape, and restore focus to the trigger. Form fields have associated labels; errors are announced to assistive technology. Status is never conveyed by color alone.

**NFR-05 — Responsive, mobile-first.** The layout is designed for a 320px-wide viewport first and scales up to tablet and desktop. No horizontal scrolling at any width from 320px up. Primary tap targets are at least 44x44px. Todo rows, filters, and forms remain fully usable on a phone.

**NFR-06 — Dark mode.** The app supports light and dark themes via the class-based `.dark` toggle on `<html>` (HeroUI v3 convention). The theme follows the OS preference by default and is applied without a flash of the wrong theme on first paint. Text meets WCAG AA contrast (4.5:1 for body text) in both themes.

**NFR-07 — No secrets in client bundles.** `DATABASE_URL`, `BETTER_AUTH_SECRET`, and any other server-only value never appear in client components, `NEXT_PUBLIC_*` variables, or the shipped JavaScript bundle. Prisma is only imported in server code. Secrets are never logged or committed; `.env`, `.env.local` stay gitignored.

**NFR-08 — Validation parity.** Every field rule in section 2 is enforced server-side, with matching client-side messages. Server validation failures return a message the UI can display next to the offending field.

**NFR-09 — Performance.** The todo list for a typical user (up to 200 todos) renders in a single query using the `[userId, completed]` index, with no N+1 queries. Toggle, create, edit, and delete update the list without a full page reload.

**NFR-10 — Build quality gate.** `npx tsc --noEmit` and `npm run lint` are clean and `npm run build` succeeds before any story is considered done (per `docs/STACK.md`).

---

## 6. Priority table

| ID | Story | Priority |
|---|---|---|
| US-01 | Sign up with email + password | Must |
| US-02 | Sign in | Must |
| US-03 | Sign out | Must |
| US-04 | Protected routes | Must |
| US-05 | Create a todo | Must |
| US-06 | List todos | Must |
| US-07 | Toggle complete/incomplete | Must |
| US-08 | Edit a todo | Should |
| US-09 | Delete a todo with confirmation | Must |
| US-10 | Filter by status and priority | Should |
| US-11 | Empty state | Should |

Non-functional priorities: NFR-01, NFR-02, NFR-03, NFR-07, NFR-10 are **Must**. NFR-04, NFR-05, NFR-08 are **Must**. NFR-06 (dark mode) and NFR-09 (performance) are **Should**.

---

## 7. Release criteria for v1

1. All Must stories pass their acceptance criteria.
2. A test proves User A cannot read, edit, toggle, or delete a todo belonging to User B via a direct request.
3. Unauthenticated access to every protected route redirects to `/sign-in`.
4. The build quality gate (NFR-10) is green.
