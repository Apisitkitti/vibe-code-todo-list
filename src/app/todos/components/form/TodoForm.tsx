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
import { PRIORITY_VALUES } from "@/lib/todo";

const PRIORITY_OPTIONS = PRIORITY_VALUES.map((priority) => ({
  id: priority,
  label: PRIORITY_FILTER_LABELS[priority],
}));

import {
  todoFormSchema,
  type TodoFieldErrors,
  type TodoFormInput,
  type TodoFormValues,
} from "./schema";

export interface TodoFormProps {
  /** Ties the form to a submit button rendered outside it, in the modal footer. */
  formId: string;
  defaultValues: TodoFormValues;
  /** Errors the server reported for a submission the client thought was valid. */
  serverFieldErrors?: TodoFieldErrors | null;
  isDisabled?: boolean;
  onValidSubmit: (values: TodoFormValues) => void;
}

/**
 * Fields only. Submitting hands validated values to the parent, which runs the
 * confirm-then-mutate flow (`docs/CONVENTIONS.md` → Mutation UX).
 */
export const TodoForm = ({
  formId,
  defaultValues,
  serverFieldErrors,
  isDisabled = false,
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
      className="flex flex-col gap-4"
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
            autoFocus
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
          />
        )}
      />
    </Form>
  );
};
