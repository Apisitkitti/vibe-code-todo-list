"use client";

import { useState } from "react";

import {
  Button,
  Modal,
  Spinner,
  toast,
  useMediaQuery,
  type UseOverlayStateReturn,
} from "@heroui/react";

import { CANCEL_LABEL } from "@/app/todos/constants";
import { getErrorMessage } from "@/lib/getErrorMessage";
import { toDueDateInputValue, type TodoItemData } from "@/lib/todo";
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

const toFormValues = (todo: TodoItemData | null): TodoFormValues => {
  if (!todo) return DEFAULT_TODO_FORM_VALUES;

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
export const TodoFormModal = ({ state, todo, onSaved }: TodoFormModalProps) => {
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
    const previousValues = todo ? toFormValues(todo) : null;

    let saved: TodoItemData;

    // Only the write belongs in here. Handing the result upward from inside
    // the `try` would report the list's own failures as a failed save
    // (review r-4).
    try {
      saved = isEdit
        ? await updateTodo(todo.id, values)
        : await createTodo(values);
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
    <Modal state={state}>
        <Modal.Backdrop variant="blur">
          <Modal.Container
            size={isDesktop ? "md" : "full"}
            placement={isDesktop ? "center" : "bottom"}
          >
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>
                  {isEdit ? "Edit todo" : "New todo"}
                </Modal.Heading>
                <Modal.CloseTrigger aria-label="Close" />
              </Modal.Header>
              <Modal.Body>
                <TodoForm
                  formId={FORM_ID}
                  defaultValues={toFormValues(todo)}
                  serverFieldErrors={serverFieldErrors}
                  isDisabled={isPending}
                  onValidSubmit={(values) => {
                    void handleValidSubmit(values);
                  }}
                />
              </Modal.Body>
              <Modal.Footer className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="tertiary"
                  className="min-h-11 w-full sm:w-auto"
                  isDisabled={isPending}
                  onPress={closeForm}
                >
                  {CANCEL_LABEL}
                </Button>
                <Button
                  type="submit"
                  form={FORM_ID}
                  variant="primary"
                  className="min-h-11 w-full sm:w-auto"
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
    </Modal>
  );
};
