# Route handlers — `src/app/api/**`

Read before adding or changing anything under `src/app/api/`. This is the trust
boundary; everything in front of it is untrusted input.

## The three steps, in order

Every handler, every time. A handler that skips one is a security defect.

### 1. Session first, before any read

```ts
const session = await getSession();
if (!session?.user) return unauthorizedResponse();
```

`getSession()`, not `requireUser()`. `requireUser` *redirects*, which is correct
for a server component and meaningless to an axios call that asked for JSON.
`getSession` is wrapped in React's `cache()`, so several calls in one request
resolve the session once.

Never read a user id from the request body, the query string, or a header. The
only id that exists is `session.user.id`. `tests/api/isolation.test.ts` asserts
that a spoofed `userId` in a create body is ignored and the row is filed under
the session user.

### 2. Re-validate the body with the same schema the form used

```ts
const body = await readJsonBody(request);          // null on malformed JSON
const parsed = todoFormSchema.safeParse(body);
if (!parsed.success) return badRequestResponse(toFieldErrors(parsed.error));
```

The client already validated. That was UX. This is the copy that is trusted, and
it is why the schema lives in `src/lib/todo.schema.ts` rather than in a form
folder — the API cannot depend on a screen's presentation layer.

Reject what the route does not own rather than parsing it away. `mentionsCompleted(body)`
returns a `400` from the create and save routes, because a body that half-matches
would otherwise get half-applied: a `200` that looks like a save and silently
dropped something.

### 3. Scope every query by the session user's id, in the same statement

```ts
const result = await prisma.todo.updateMany({
  where: { id, userId: session.user.id },
  data,
});
if (result.count === 0) return notFoundResponse();
```

`updateMany` / `deleteMany` with a compound `where`, never fetch-then-check.
Zero rows matched means "missing or not yours", and both answer **404**. A 403
would confirm the row exists, which is the fact being protected.

When a `where` grows an `OR`, the scope sits **beside** it, never around it:

```ts
const where: Prisma.TodoWhereInput = { userId: session.user.id };
where.OR = [{ title: { contains: term } }, { note: { contains: term } }];
// reads: userId = me AND (title ~ q OR note ~ q)
```

Prisma ANDs the top-level keys, so the scope constrains every branch. Folding
`userId` into one arm leaves the other arm unscoped and turns a search box into
a reader of everybody's rows. That is the property to check when reviewing any
diff that touches a `where`.

## One route per operation

```
src/app/api/todos/
  route.ts               GET (list), POST (create)
  [id]/route.ts          PATCH (save fields), DELETE
  [id]/status/route.ts   PATCH (toggle completion)
  util.ts                row → response body, shared reads, body parsing
  errors.ts              status responses, field-error mapping
```

Changing a record's status is its own route, not a branch inside the update
handler. When one handler serves two intents it has to guess from the body
shape, and a body that half-matches gets half-applied. Each route also rejects
the other's body and names the route that wants it, so the caller is told what
to do rather than merely refused.

`[id]/status/route.ts` uses `.strict()` on its schema for the same reason: an
unrecognised key is rejected rather than quietly ignored.

## `util.ts` vs `errors.ts`

- **`util.ts` — the success side.** Turning a database row into the response
  body, the reads the handlers share, reading the request body, the shared
  `orderBy`.
- **`errors.ts` — the error side.** The `401` / `404` / `400` responses, their
  domain wording, and the zod-issue → field-error mapping.

Name it `errors.ts`, **never** `error.ts`. Anything called `error.*` under
`app/` is Next's error-boundary convention and the build fails with "must be a
Client Component".

There is no per-API model file. Response types are the canonical ones in
`src/lib/<resource>.ts`, which the client already uses. A second declaration of
the same record is only something to keep in sync.

## Error responses

`src/lib/apiError.ts` owns the body shape, the status per code, and the default
message per code:

```ts
apiError(ApiErrorCode.Unauthorized);
apiError(ApiErrorCode.NotFound, { message: TODO_NOT_FOUND_MESSAGE });
apiError(ApiErrorCode.BadRequest, { message, fieldErrors });
```

```json
{ "code": "UNAUTHORIZED", "message": "Sign in again to continue." }
```

- A handler **never** calls `NextResponse.json` for an error and never writes a
  status by hand. It picks a code.
- A resource's `errors.ts` may override the *message* for domain wording. Never
  the shape, never the status.
- `fieldErrors` is omitted entirely when empty, so its presence always means a
  field-level validation failure.
- A new kind of error means a new `ApiErrorCode` in that one file, not a new
  ad-hoc body in a handler.

The client depends on this: `getErrorMessage` reads `message` and expects it on
every error response from every endpoint.

`toFieldErrors` matches zod paths against the form's own field list rather than
casting into it, so a path the form does not know about — a renamed field, or
`completed`, which is not a form field — is dropped rather than typed as a form
error and discovered by the client.

## Known gap, worth closing if you are in here anyway

`ApiErrorCode.Internal` is declared and **never constructed**: no handler has a
`try`/`catch`, so a database failure returns Next's HTML 500 with no `message`,
and nothing logs it. Filed as `docs/REVIEW.md` §1.6 / E-8. If you add the catch,
log the code path and the error class — never the todo text.
