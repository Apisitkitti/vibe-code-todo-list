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

import { QUICK_ADD_EXAMPLE } from "@/app/todos/constants";
import { FormTextField } from "@/components/ui";
import {
  NO_RELEASE,
  heldRelease,
  parseQuickAdd,
  releaseAfterEdit,
  releaseAgainst,
  type QuickAddRelease,
  type QuickAddTokenKind,
} from "@/lib/quickAdd";
import {
  CHIP_SIZING,
  FULL_WIDTH_ACTION_SIZING,
  SECONDARY_ACTION_SIZING,
} from "@/lib/styles";
import { todoFormSchema, type TodoFormValues } from "@/lib/todo.schema";

import { quickAddSchema, type QuickAddValues } from "./schema";

/** Copy deck, `docs/DESIGN.md` §7.17. */
const FIELD_LABEL = "Add a todo";
/*
  Built from `QUICK_ADD_EXAMPLE` rather than written out, because the empty
  state's syntax line shows the same example (§7.7) and the two must not drift
  into teaching one parser two vocabularies.
*/
const FIELD_PLACEHOLDER = `Add a todo — try "${QUICK_ADD_EXAMPLE}"`;
const SUBMIT_LABEL = "Add";
const SUBMIT_PENDING_LABEL = "Adding…";
const MORE_OPTIONS_LABEL = "More options";
const CHIP_GROUP_LABEL = "Read from your text";
const CHIP_HINT = "Press Esc to keep your text exactly as typed.";

const ESCAPE_KEY = "Escape";

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
  /**
   * Hands the current reading to the modal, so nothing is typed twice, and
   * resolves when that modal is done with: `true` if it saved, `false` if the
   * user backed out of it.
   *
   * The same contract as `onValidSubmit`, for the same reason — **resolving
   * `false` is what keeps every character on screen** (QA DEF-23). A handoff
   * is not a commit, so `Cancel`, `Escape` and the close `×` must all cost
   * nothing; the bar keeps its text through a 500, a 502 and a field error,
   * and a reversible action the user chose cannot be the one path that loses
   * it (`docs/PRD.md` US-05).
   */
  onMoreOptions: (values: TodoFormValues) => Promise<boolean>;
}

/**
 * The bar's interior: the input, the parsed-token chips, and the two buttons.
 * The write itself belongs to `QuickAddBar`, the same way `TodoForm` leaves it
 * to `TodoFormModal`.
 *
 * **The chips are controls, not labels.** Each one is a button that puts its
 * words back into the title and releases its kind, which re-reads the text
 * with that kind stepped over rather than switched off — so releasing the date
 * never costs the priority. `Esc` does it for every chip **on screen** without
 * leaving the input, which is the keyboard-first version of the same escape
 * hatch — and only for those, because a refusal of something never offered
 * records a reading the user was never shown (`handleKeyDown`, QA DEF-24).
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
  /** Only a refusal whose reading is still on screen counts. See below. */
  const activeRelease = heldRelease(release, text);
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
    setRelease(releaseAgainst(getValues("text"), [...activeRelease, ...kinds]));
  };

  /**
   * Every edit, and the one place a refusal ends.
   *
   * `releaseAfterEdit` is applied here rather than only derived at render
   * because **a lapsed refusal must not come back** (Senior F1). Derivation
   * alone answers "does the text end in the refused words *right now*", which
   * a retyped line satisfies again the moment the user reaches the same last
   * word — so the chips would vanish mid-sentence with no signal, which is the
   * dead parser review B-2 was filed about. Dropping the state on the edit
   * that leaves the reading makes it one-way: retyping a line means passing
   * through a state that is not the reading, and that ends it.
   *
   * The derivation above stays, because it is what keeps this render
   * self-consistent — the state update has not landed yet — and because
   * `clearTo` is the other way a refusal ends.
   */
  const handleTextChange = (next: string, onChange: (value: string) => void) => {
    onChange(next);
    setRelease((current) => releaseAfterEdit(current, next));
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
   * The handoff to the modal — and it clears the bar on the *save*, never on
   * the press (QA DEF-23).
   *
   * Emptying it here used to be the last statement of this handler, which made
   * `More options` the one control in the feature that could destroy typed
   * text: the modal it opens is dismissible three ways, none of them commits
   * anything, and there is no Undo for a mutation that never happened. Waiting
   * for the answer costs nothing — a cancelled handoff leaves the bar exactly
   * as the user left it, chips and all.
   */
  const handleMoreOptions = async () => {
    const saved = await onMoreOptions(toFormValues());

    if (!saved) {
      /*
        The bar is where the user is again, and §7.17 now says so: the text is
        "ready to submit as it stands". HeroUI restores focus to the button
        that opened the dialog, which is the right default for a control that
        did something and the wrong one for a handoff that was called off —
        it leaves the caret one Tab from the line it was in the middle of.
      */
      inputRef.current?.focus();

      return;
    }

    clearTo("");
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

  /**
   * `Esc` is **every chip at once, and nothing else** (QA DEF-24).
   *
   * It used to release both kinds unconditionally, which meant it could refuse
   * a kind that was never offered — and refusing a kind rule 2 had *declined to
   * lift* is not free. `releaseAgainst` re-reads the line with that kind
   * stepped over, and a step-over is not gated by `canLift`, so the scan walked
   * straight past a run that is still sitting in the title and recorded a
   * `tail` reaching words no chip ever named. `stillReads` then read an edit to
   * those title words as an edit to the reading, the refusal lapsed, the chip
   * came back, and Enter ate the word: `in 3 days high`, `Esc`, correct your
   * own `3` to a `4`, and you save `in 4 days` at High priority. That is
   * DEF-22's harm reached through `Esc`.
   *
   * Releasing only the kinds on screen is exactly what pressing every chip in
   * turn does, which is what §7.17 has always said `Esc` is, and it is why the
   * chip path never had this defect. It is also provably safe rather than
   * merely narrower: a kind that *fired* was lifted, so releasing it moves its
   * words from `lifted` to `steppedOver` — one for one, and `canLift`
   * subtracts both (RB-1). The budget is therefore unchanged at every step, the
   * scan stops exactly where the user watched it stop, and the recorded reading
   * is the reading on screen.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== ESCAPE_KEY || parsed.tokens.length === 0) return;

    event.preventDefault();
    releaseKinds(parsed.tokens.map((token) => token.kind));
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
                onChange={(next) => {
                  handleTextChange(next, field.onChange);
                }}
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
          className={FULL_WIDTH_ACTION_SIZING}
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
                className={`${CHIP_SIZING} rounded-full`}
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
            {/*
              `aria-hidden`, because the live region above already carries
              this sentence and announces it at the moment it becomes
              relevant. Leaving both exposed reads the same hint twice to
              anyone browsing the page.
            */}
            <Typography type="body-sm" color="muted" aria-hidden="true">
              {CHIP_HINT}
            </Typography>
          </div>
        ) : null}

        <Button
          type="button"
          variant="tertiary"
          size="sm"
          className={`${SECONDARY_ACTION_SIZING} sm:ml-auto`}
          isDisabled={isPending}
          onPress={() => {
            void handleMoreOptions();
          }}
        >
          {MORE_OPTIONS_LABEL}
        </Button>
      </div>
    </Form>
  );
};
