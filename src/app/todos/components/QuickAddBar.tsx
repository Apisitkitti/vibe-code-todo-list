"use client";

import { useState, type RefObject } from "react";

import { toast } from "@heroui/react";

import { getErrorMessage } from "@/lib/getErrorMessage";
import type { TodoItemData } from "@/lib/todo";
import { createTodo } from "@/service/todo.service";

import {
  QuickAddForm,
  readFieldErrors,
  type TodoFormValues,
} from "./form";

/** Copy deck, `docs/DESIGN.md` §7.17 — the same fallback the modal uses. */
const CREATE_FAILURE_MESSAGE = "Couldn’t add the todo. Try again.";

export interface QuickAddBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  /**
   * Hands the created record to the list, which reloads and raises the toast
   * with its Undo. `previous` is `null` on a create, matching the modal's
   * `onSaved`, so both capture paths report through one place.
   */
  onCreated: (saved: TodoItemData) => void;
  onMoreOptions: (draft: TodoFormValues) => void;
}

/**
 * The write half of the quick-add bar, and the mirror of `TodoFormModal`: the
 * form collects, this performs, and the list reports.
 *
 * A create destroys nothing, so it does not confirm — it fires on Enter and
 * the list's toast carries Undo (`docs/CONVENTIONS.md` → Mutation UX). It
 * calls the same `createTodo` service, the same `POST /api/todos`, and is
 * re-validated by the same `todoFormSchema` against the same
 * `userId: session.user.id`. Reading the typed text is a client-side
 * convenience over a title string and nothing else; a hostile client that
 * skips it gets exactly the behaviour it gets today.
 */
export const QuickAddBar = ({
  inputRef,
  onCreated,
  onMoreOptions,
}: QuickAddBarProps) => {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  /**
   * Resolving `false` is what keeps the typed text on screen. Every failure
   * path below returns it, including the one that reports a field error, so
   * there is no route through this function that loses a keystroke.
   */
  const handleValidSubmit = async (values: TodoFormValues): Promise<boolean> => {
    if (isPending) return false;

    setServerError(null);
    setIsPending(true);

    let saved: TodoItemData;

    // Only the write is inside the `try`. Handing the result upward from in
    // here would report the list's own failures as a failed create (r-4).
    try {
      saved = await createTodo(values);
    } catch (error) {
      const fieldErrors = readFieldErrors(error);

      if (fieldErrors?.title) {
        setServerError(fieldErrors.title);

        return false;
      }

      toast.danger(getErrorMessage(error, CREATE_FAILURE_MESSAGE));

      return false;
    } finally {
      setIsPending(false);
    }

    onCreated(saved);

    return true;
  };

  return (
    <QuickAddForm
      inputRef={inputRef}
      isPending={isPending}
      serverError={serverError}
      onValidSubmit={handleValidSubmit}
      onMoreOptions={(draft) => {
        setServerError(null);
        onMoreOptions(draft);
      }}
    />
  );
};
