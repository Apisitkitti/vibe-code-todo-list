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
import { ConfirmDialog } from "@/components/ConfirmDialog";
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

// Each pending label is rendered twice: on the submit button and, once the
// user confirms, on the confirm dialog's own action.
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
  /** Lets the list reload itself once the write has landed. */
  onSaved: () => void;
}

/**
 * One modal for create and edit. Submitting only opens the confirm dialog;
 * the mutation runs after the user confirms and always reports through a
 * toast (`docs/CONVENTIONS.md` → Mutation UX).
 */
export const TodoFormModal = ({ state, todo, onSaved }: TodoFormModalProps) => {
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const isEdit = todo !== null;

  const [pendingValues, setPendingValues] = useState<TodoFormValues | null>(null);
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

  const closeConfirm = () => {
    if (isPending) return;

    setPendingValues(null);
  };

  /**
   * This component stays mounted between openings, and two consecutive creates
   * share the same `key`, so a stale `serverFieldErrors` would render on the
   * next brand-new form as though it had already been submitted (review m-1).
   */
  const closeForm = () => {
    setServerFieldErrors(null);
    state.close();
  };

  const handleConfirm = async () => {
    if (!pendingValues) return;

    setIsPending(true);

    try {
      if (isEdit) {
        await updateTodo(todo.id, pendingValues);
      } else {
        await createTodo(pendingValues);
      }

      toast.success(
        isEdit
          ? `Todo “${pendingValues.title}” updated`
          : `Todo “${pendingValues.title}” added`,
      );

      setPendingValues(null);
      closeForm();
      onSaved();
    } catch (error) {
      const fieldErrors = readFieldErrors(error);

      if (fieldErrors) {
        // A 400: the server rejected something the client thought was valid.
        // Keep the form open with the typed values and mark the bad fields.
        setServerFieldErrors(fieldErrors);
        setPendingValues(null);

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
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
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
                    setServerFieldErrors(null);
                    setPendingValues(values);
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

      <ConfirmDialog
        isOpen={pendingValues !== null}
        heading={isEdit ? "Save these changes?" : "Add this todo?"}
        body={
          isEdit
            ? `“${pendingValues?.title ?? ""}” will be updated.`
            : `“${pendingValues?.title ?? ""}” will be added to your list.`
        }
        confirmLabel={isEdit ? "Save changes" : "Add todo"}
        pendingLabel={isEdit ? UPDATE_PENDING_LABEL : CREATE_PENDING_LABEL}
        isPending={isPending}
        onConfirm={handleConfirm}
        onOpenChange={(isOpen) => {
          if (!isOpen) closeConfirm();
        }}
      />
    </>
  );
};
