"use client";

import { useState } from "react";

import {
  Button,
  Modal,
  Spinner,
  useMediaQuery,
  type UseOverlayStateReturn,
} from "@heroui/react";

import { toast } from "@/lib/toast";
import { CANCEL_LABEL } from "@/app/todos/constants";
import { getErrorMessage } from "@/lib/getErrorMessage";
import { DIALOG_FOOTER_LAYOUT, FULL_WIDTH_ACTION_SIZING } from "@/lib/styles";
import {
  toDueDateInputValue,
  truncateForAnnouncement,
  type TodoFormFocus,
  type TodoItemData,
} from "@/lib/todo";
import { createTodo, updateTodo } from "@/service/todo.service";

import {
  DEFAULT_TODO_FORM_VALUES,
  TodoForm,
  readFieldErrors,
  type TodoFieldErrors,
  type TodoFormValues,
} from "./form";

const FORM_ID = "todo-form";
const DESKTOP_MEDIA_QUERY = "(min-width: 640px)";

// Shown on the submit button while the write is in flight.
const CREATE_PENDING_LABEL = "Adding…";
const UPDATE_PENDING_LABEL = "Saving…";

/**
 * The dialog's name (`docs/DESIGN.md` §7.5).
 *
 * **The edit dialog names the record, and it did not use to.** `Edit todo`
 * named the surface and nothing else; which record was spoken on open only by
 * accident, because focus landed on `Title` and a screen reader read the
 * focused field's value. §7.21's `Pick a date…` ruling moves that focus to
 * `Due date` and takes the accident away — so a user who opened the editor
 * from a row would hear `Edit todo, dialog. Due date…` and never learn which
 * todo they were in. The name carries the title instead of depending on a side
 * effect of focus placement.
 *
 * **The string is truncated in the DOM, not only in CSS**, and that is what
 * makes one value satisfy both of §7.5's bounds at once. A dialog name is read
 * in full, on open, before the user has been told it is a dialog and with no
 * way to skip it — and titles here run to `TITLE_MAX_LENGTH`. Truncating only
 * with CSS would leave the accessible name carrying all 200 characters, since
 * `text-overflow` clips pixels and not the accessibility tree. Cutting the text
 * itself bounds the announcement, and `truncate` then keeps the visible
 * heading to one line if the cut string is still wider than the header band.
 *
 * The full title is never lost: it is in the `Title` field two lines below,
 * which is the same relationship §4.4's truncated row has with its own title.
 *
 * Create stays `New todo` — there is no record to name yet, and naming the
 * draft would present it as one.
 */
const CREATE_HEADING = "New todo";

const editHeading = (title: string) =>
  `Edit “${truncateForAnnouncement(title)}”`;

const toFormValues = (
  todo: TodoItemData | null,
  draft: TodoFormValues | null,
): TodoFormValues => {
  if (!todo) return draft ?? DEFAULT_TODO_FORM_VALUES;

  return {
    title: todo.title,
    note: todo.note ?? "",
    priority: todo.priority,
    dueAt: toDueDateInputValue(todo.dueAt),
  };
};

export interface TodoFormModalProps {
  state: UseOverlayStateReturn;
  /** `null` puts the modal in create mode. */
  todo: TodoItemData | null;
  /**
   * Create mode only: what the quick-add bar had already read from the typed
   * text when `More options` was pressed, so nothing is typed twice
   * (`docs/PRD.md` US-05). Ignored on an edit, where the record wins.
   */
  draft?: TodoFormValues | null;
  /**
   * Which field the form opens on. Passed straight through — the modal has no
   * opinion about it, because the opinion belongs to whatever the user
   * pressed to get here (`docs/DESIGN.md` §7.21).
   */
  autoFocusField?: TodoFormFocus;
  /**
   * Hands the write's result to the list, which reloads and raises the success
   * toast. `previous` is the record's state when the form opened, or `null` on
   * a create — it is what an Undo restores.
   */
  onSaved: (saved: TodoItemData, previous: TodoFormValues | null) => void;
}

/**
 * One modal for create and edit. Saving is reversible, so it submits straight
 * through — no confirm dialog — and the list offers Undo on the toast
 * (`docs/CONVENTIONS.md` → Mutation UX).
 */
export const TodoFormModal = ({
  state,
  todo,
  draft = null,
  autoFocusField,
  onSaved,
}: TodoFormModalProps) => {
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const isEdit = todo !== null;

  const [serverFieldErrors, setServerFieldErrors] =
    useState<TodoFieldErrors | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [wasOpen, setWasOpen] = useState(state.isOpen);

  // Escape and the close trigger go through `state` directly rather than
  // `closeForm`, so the reset is anchored to the dialog actually closing.
  // Adjusted during render rather than in an effect, the same way
  // `TodoFilters` follows the URL.
  if (wasOpen !== state.isOpen) {
    setWasOpen(state.isOpen);

    if (!state.isOpen) setServerFieldErrors(null);
  }

  /**
   * This component stays mounted between openings, and two consecutive creates
   * share the same `key`, so a stale `serverFieldErrors` would render on the
   * next brand-new form as though it had already been submitted (review m-1).
   */
  const closeForm = () => {
    setServerFieldErrors(null);
    state.close();
  };

  /**
   * Saving is reversible, so it goes straight through — no confirm dialog. The
   * success toast and its Undo belong to the list, which is the only place
   * that can dismiss an earlier Undo when a later write lands (review M-2).
   */
  const handleValidSubmit = async (values: TodoFormValues) => {
    if (isPending) return;

    setServerFieldErrors(null);
    setIsPending(true);

    // Captured before the write, since `todo` is the pre-edit record.
    const previousValues = todo ? toFormValues(todo, null) : null;

    let saved: TodoItemData;

    // Only the write belongs in here. Handing the result upward from inside
    // the `try` would report the list's own failures as a failed save
    // (review r-4).
    try {
      /*
        `form` regardless of how the modal was reached (backlog #5). `More
        options` opens it from the quick-add bar, but the todo is still
        captured through the full form — the measurement is of the surface the
        user filled in, not of the button they arrived by.
      */
      saved = isEdit
        ? await updateTodo(todo.id, values)
        : await createTodo(values, "form");
    } catch (error) {
      const fieldErrors = readFieldErrors(error);

      if (fieldErrors) {
        // A 400: the server rejected something the client thought was valid.
        // Keep the form open with the typed values and mark the bad fields.
        setServerFieldErrors(fieldErrors);

        return;
      }

      toast.danger(
        getErrorMessage(
          error,
          isEdit
            ? "Couldn’t save your changes. Try again."
            : "Couldn’t add the todo. Try again.",
        ),
      );

      return;
    } finally {
      setIsPending(false);
    }

    closeForm();
    onSaved(saved, previousValues);
  };

  return (
    /*
      No `<Modal>` root here, and that is what closes QA DEF-02 — the
      `A PressResponder was rendered without a pressable child` warning that
      has been in every console log this project has produced.

      `Modal`'s root is react-aria's `DialogTrigger`
      (`@heroui/react/dist/components/modal/modal.js` → `ModalRoot`), which
      wraps its children in a `PressResponder` unconditionally so that a
      `Modal.Trigger` beneath it can register as the pressable that opens the
      dialog. `docs/DESIGN.md` §4.5 says explicitly not to use `Modal.Trigger`
      here, because one modal is opened from the quick-add bar and from every
      row's edit button — so nothing ever registers and the responder warns,
      once per mount. The warning is therefore ours and not HeroUI's: the
      library is reporting, correctly, that we asked for a trigger and gave it
      nothing to trigger with.

      `ConfirmDialog` had the identical defect and closed it the identical way
      (`docs/REVIEW.md`, DEF-02). `Backdrop` is a `ModalOverlay`, which builds
      its own overlay state from `isOpen` / `onOpenChange` and publishes it as
      the `OverlayTriggerStateContext` that `Modal.Dialog`, `Escape`, the
      backdrop dismiss and `Modal.CloseTrigger`'s `slot="close"` all read — so
      dropping the root removes the trigger plumbing and nothing else. It also
      computes the full slot set itself rather than inheriting it, which is why
      the styling is unchanged.
    */
    <Modal.Backdrop
      variant="blur"
      isOpen={state.isOpen}
      onOpenChange={state.setOpen}
    >
      <Modal.Container
        size={isDesktop ? "md" : "full"}
        placement={isDesktop ? "center" : "bottom"}
      >
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading className="truncate">
              {isEdit ? editHeading(todo.title) : CREATE_HEADING}
            </Modal.Heading>
            <Modal.CloseTrigger aria-label="Close" />
          </Modal.Header>
          <Modal.Body>
            <TodoForm
              formId={FORM_ID}
              defaultValues={toFormValues(todo, draft)}
              serverFieldErrors={serverFieldErrors}
              isDisabled={isPending}
              autoFocusField={autoFocusField}
              onValidSubmit={(values) => {
                void handleValidSubmit(values);
              }}
            />
          </Modal.Body>
          <Modal.Footer className={DIALOG_FOOTER_LAYOUT}>
            <Button
              variant="tertiary"
              className={FULL_WIDTH_ACTION_SIZING}
              isDisabled={isPending}
              onPress={closeForm}
            >
              {CANCEL_LABEL}
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              variant="primary"
              className={FULL_WIDTH_ACTION_SIZING}
              isDisabled={isPending}
            >
              {isPending ? (
                <>
                  <Spinner size="sm" color="current" />
                  {isEdit ? UPDATE_PENDING_LABEL : CREATE_PENDING_LABEL}
                </>
              ) : isEdit ? (
                "Save changes"
              ) : (
                "Add todo"
              )}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
};
