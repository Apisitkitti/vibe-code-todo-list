"use client";

import {
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { Button, Form, Spinner, Typography } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";

import { FormTextField } from "@/components/ui";
import { parseQuickAdd, type QuickAddTokenKind } from "@/lib/quickAdd";

import {
  quickAddSchema,
  todoFormSchema,
  type QuickAddValues,
  type TodoFormValues,
} from "./schema";

/** Copy deck, `docs/DESIGN.md` §7.17. */
const FIELD_LABEL = "Add a todo";
const FIELD_PLACEHOLDER = 'Add a todo — try "pay rent friday high"';
const SUBMIT_LABEL = "Add";
const SUBMIT_PENDING_LABEL = "Adding…";
const MORE_OPTIONS_LABEL = "More options";
const CHIP_GROUP_LABEL = "Read from your text";
const CHIP_HINT = "Press Esc to keep your text exactly as typed.";

const ESCAPE_KEY = "Escape";

/** Every kind, for the one keystroke that releases all of them at once. */
const ALL_TOKEN_KINDS: readonly QuickAddTokenKind[] = ["due", "priority"];

/**
 * A refusal, and the exact text it was made against.
 *
 * **Keyed to the text, which is what stops it going stale** (review B-2). A
 * release was previously a bare set of kinds that nothing ever cleared, so one
 * `Esc` left the parser dead for everything typed afterwards — no chips, no
 * date, no priority and no signal that anything had been switched off — and
 * the same set leaked into the next todo during burst capture. Deriving the
 * active release from an exact string match means there is no stale state to
 * clear: change one character and the reading starts fresh, visibly, with the
 * chips back and refusable again.
 *
 * The trade is that an edit-and-retype re-offers a parse the user already
 * refused once. That is the right way round: an unwanted chip is on screen and
 * costs one keystroke, while a silently disabled parser is invisible.
 */
interface QuickAddRelease {
  text: string;
  kinds: readonly QuickAddTokenKind[];
}

const NO_RELEASE: QuickAddRelease = { text: "", kinds: [] };

export interface QuickAddFormProps {
  /** Focused by the empty state's call to action, and after every create. */
  inputRef: RefObject<HTMLInputElement | null>;
  isPending?: boolean;
  /** An error the server reported against the title of a valid-looking parse. */
  serverError?: string | null;
  /**
   * Performs the write. Resolving `true` is what clears the input — a `false`
   * leaves every character where it is, because retyping a todo the app lost
   * is what makes people stop trusting it (`docs/PRD.md` US-05).
   */
  onValidSubmit: (values: TodoFormValues) => Promise<boolean>;
  /** Hands the current reading to the modal, so nothing is typed twice. */
  onMoreOptions: (values: TodoFormValues) => void;
}

/**
 * The bar's interior: the input, the parsed-token chips, and the two buttons.
 * The write itself belongs to `QuickAddBar`, the same way `TodoForm` leaves it
 * to `TodoFormModal`.
 *
 * **The chips are controls, not labels.** Each one is a button that puts its
 * words back into the title and releases its kind, which re-reads the text
 * with that kind stepped over rather than switched off — so releasing the date
 * never costs the priority. `Esc` does it for all of them without leaving the
 * input, which is the keyboard-first version of the same escape hatch.
 * Without this the parser would be able to lift a word the user meant
 * literally with no way back, and that is the one failure this feature is not
 * allowed to have (`docs/DESIGN.md` §7.17).
 */
export const QuickAddForm = ({
  inputRef,
  isPending = false,
  serverError,
  onValidSubmit,
  onMoreOptions,
}: QuickAddFormProps) => {
  const [release, setRelease] = useState<QuickAddRelease>(NO_RELEASE);

  const {
    control,
    formState: { errors },
    getValues,
    handleSubmit,
    reset,
    setError,
  } = useForm<QuickAddValues>({
    resolver: zodResolver(quickAddSchema),
    defaultValues: { text: "" },
  });

  const text = useWatch({ control, name: "text" }) ?? "";
  /** Only the refusal made against *this* text counts. See `QuickAddRelease`. */
  const activeRelease = release.text === text ? release.kinds : [];
  /*
    Read on every render rather than memoised against a captured `now`: "today"
    is a fact about the reader's clock, and a bar left open across midnight
    must not still be offering yesterday. This is the same call `TodoDueDate`
    makes when it formats a row.
  */
  const parsed = parseQuickAdd(text, { release: activeRelease });
  const errorMessage = errors.text?.message ?? serverError ?? undefined;

  /**
   * The parse, said out loud (review MA-5). The chips are buttons a screen
   * reader only meets by tabbing to them, so without this the single thing
   * §7.17 calls non-negotiable — that the reading is visible before it is
   * committed — is available to sighted users only.
   *
   * `polite`, and it only changes when the *reading* changes rather than on
   * every keystroke, so it does not narrate typing.
   */
  const announcement =
    parsed.tokens.length === 0
      ? ""
      : `${CHIP_GROUP_LABEL}: ${parsed.tokens
          .map((token) => token.label)
          .join(", ")}. ${CHIP_HINT}`;

  /** The todo the current text describes — what both buttons act on. */
  const toFormValues = (): TodoFormValues => ({
    title: parsed.title,
    note: "",
    priority: parsed.priority,
    dueAt: parsed.dueAt,
  });

  const releaseKinds = (kinds: readonly QuickAddTokenKind[]) => {
    const current = getValues("text");

    setRelease({
      text: current,
      kinds: [...new Set([...activeRelease, ...kinds])],
    });
  };

  const clearTo = (next: string) => {
    reset({ text: next });
    setRelease(NO_RELEASE);
  };

  /**
   * The parse is re-validated with `todoFormSchema` — the very schema the
   * route handler re-parses with — rather than with a second set of length
   * rules written into `quickAddSchema`. A title too long is therefore
   * reported with the same words here, in the modal, and from the server.
   */
  const submit = async () => {
    const checked = todoFormSchema.safeParse(toFormValues());

    if (!checked.success) {
      const issue = checked.error.issues[0];

      setError("text", { message: issue?.message ?? "Enter a title." });

      return;
    }

    const submitted = getValues("text");
    const created = await onValidSubmit(checked.data);

    if (!created) return;

    /*
      The input is never disabled while the write is in flight — disabling it
      would drop focus, and focus staying put is the feature. That leaves one
      window: a fast typist who has already started the next todo when this one
      lands. Taking the submitted text off the front, rather than skipping the
      reset, keeps their keystrokes *and* leaves the bar holding only the next
      todo — the earlier version kept the whole string, so the created todo's
      words stayed glued to the front of the next one.
    */
    const current = getValues("text");

    clearTo(current.startsWith(submitted) ? current.slice(submitted.length) : "");

    // The feature is the next todo, not this one: focus never leaves the bar.
    inputRef.current?.focus();
  };

  /**
   * `handleSubmit` is called here, inside the event handler, rather than at the
   * `onSubmit` prop. Called during render it would be handed a callback that
   * reaches for `inputRef.current`, which is a ref read during render — the
   * lint rule is right, and the fix is to build the handler when the event
   * happens rather than when the component paints.
   */
  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    void handleSubmit(() => submit())(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== ESCAPE_KEY || parsed.tokens.length === 0) return;

    event.preventDefault();
    releaseKinds(ALL_TOKEN_KINDS);
  };

  return (
    <Form
      className="flex flex-col gap-2"
      validationBehavior="aria"
      onSubmit={handleFormSubmit}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <Controller
            control={control}
            name="text"
            render={({ field }) => (
              <FormTextField
                name={field.name}
                label={FIELD_LABEL}
                isLabelHidden
                placeholder={FIELD_PLACEHOLDER}
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                onKeyDown={handleKeyDown}
                isInvalid={errorMessage !== undefined}
                errorMessage={errorMessage}
                inputRef={inputRef}
              />
            )}
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          className="min-h-11 w-full sm:w-auto"
          isDisabled={isPending}
        >
          {isPending ? (
            <>
              <Spinner size="sm" color="current" />
              {SUBMIT_PENDING_LABEL}
            </>
          ) : (
            SUBMIT_LABEL
          )}
        </Button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {parsed.tokens.length > 0 ? (
          <div
            role="group"
            aria-label={CHIP_GROUP_LABEL}
            className="flex flex-wrap items-center gap-2"
          >
            {parsed.tokens.map((token) => (
              <Button
                key={token.kind}
                type="button"
                variant="tertiary"
                size="sm"
                className="min-h-11 rounded-full sm:min-h-8"
                aria-label={`${token.label} — keep "${token.text}" in the title`}
                onPress={() => {
                  releaseKinds([token.kind]);
                  inputRef.current?.focus();
                }}
              >
                {token.label}
                <span aria-hidden="true">×</span>
              </Button>
            ))}
            <Typography type="body-sm" color="muted">
              {CHIP_HINT}
            </Typography>
          </div>
        ) : null}

        <Button
          type="button"
          variant="tertiary"
          size="sm"
          className="min-h-11 sm:ml-auto sm:min-h-8"
          isDisabled={isPending}
          onPress={() => {
            onMoreOptions(toFormValues());
            clearTo("");
          }}
        >
          {MORE_OPTIONS_LABEL}
        </Button>
      </div>
    </Form>
  );
};
