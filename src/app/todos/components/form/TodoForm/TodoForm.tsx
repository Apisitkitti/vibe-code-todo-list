"use client";

import { Form } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";

import { PRIORITY_FILTER_LABELS } from "@/app/todos/constants";
import {
  FormDatePicker,
  FormSelect,
  FormTextArea,
  FormTextField,
} from "@/components/ui";
import { FORM_FIELD_STACK } from "@/lib/styles";
import {
  DEFAULT_FORM_FOCUS,
  PRIORITY_VALUES,
  type TodoFormFocus,
} from "@/lib/todo";
import {
  todoFormSchema,
  type TodoFieldErrors,
  type TodoFormInput,
  type TodoFormValues,
} from "@/lib/todo.schema";

const PRIORITY_OPTIONS = PRIORITY_VALUES.map((priority) => ({
  id: priority,
  label: PRIORITY_FILTER_LABELS[priority],
}));

export interface TodoFormProps {
  /** Ties the form to a submit button rendered outside it, in the modal footer. */
  formId: string;
  defaultValues: TodoFormValues;
  /** Errors the server reported for a submission the client thought was valid. */
  serverFieldErrors?: TodoFieldErrors | null;
  isDisabled?: boolean;
  /**
   * Which field the caret lands on when the form mounts (`docs/DESIGN.md`
   * §7.21). Defaults to `title`, which is every path but one.
   */
  autoFocusField?: TodoFormFocus;
  onValidSubmit: (values: TodoFormValues) => void;
}

/**
 * Fields only. Submitting hands validated values to the parent, which performs
 * the write and reports it (`docs/CONVENTIONS.md` → Mutation UX).
 */
export const TodoForm = ({
  formId,
  defaultValues,
  serverFieldErrors,
  isDisabled = false,
  autoFocusField = DEFAULT_FORM_FOCUS,
  onValidSubmit,
}: TodoFormProps) => {
  const {
    control,
    formState: { errors },
    handleSubmit,
  } = useForm<TodoFormInput, unknown, TodoFormValues>({
    resolver: zodResolver(todoFormSchema),
    defaultValues,
  });

  // react-aria owns the presentation of field errors: it wires `aria-invalid`
  // and `aria-describedby` and renders them through `FieldError`
  // (`docs/DESIGN.md` §4.9).
  const validationErrors: Record<string, string> = {};

  for (const field of ["title", "note", "priority", "dueAt"] as const) {
    const message = errors[field]?.message ?? serverFieldErrors?.[field];

    if (message) validationErrors[field] = message;
  }

  return (
    <Form
      id={formId}
      className={FORM_FIELD_STACK}
      validationBehavior="aria"
      validationErrors={validationErrors}
      onSubmit={handleSubmit(onValidSubmit)}
    >
      <Controller
        control={control}
        name="title"
        render={({ field }) => (
          <FormTextField
            name={field.name}
            label="Title"
            placeholder="What needs doing?"
            value={field.value ?? ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            isRequired
            isDisabled={isDisabled}
            autoFocus={autoFocusField === "title"}
          />
        )}
      />

      <Controller
        control={control}
        name="note"
        render={({ field }) => (
          <FormTextArea
            name={field.name}
            label="Note"
            placeholder="Optional details"
            value={field.value ?? ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            isDisabled={isDisabled}
          />
        )}
      />

      <Controller
        control={control}
        name="priority"
        render={({ field }) => (
          <FormSelect
            name={field.name}
            label="Priority"
            options={PRIORITY_OPTIONS}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            isDisabled={isDisabled}
          />
        )}
      />

      <Controller
        control={control}
        name="dueAt"
        render={({ field }) => (
          <FormDatePicker
            name={field.name}
            label="Due date"
            description="Optional."
            value={field.value ?? ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            isDisabled={isDisabled}
            autoFocus={autoFocusField === "dueAt"}
          />
        )}
      />
    </Form>
  );
};
