"use client";

import type { KeyboardEvent, Ref } from "react";

import { Description, FieldError, Input, Label, TextField } from "@heroui/react";

export interface FormTextFieldProps {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  description?: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  autoFocus?: boolean;
  /**
   * Renders the `Label` `sr-only` rather than dropping it. §6.2 admits no
   * exception — every input has a real `Label` — so a field whose purpose is
   * already obvious from its placement (the quick-add bar) hides the words
   * instead of replacing them with an `aria-label` nobody can see either.
   */
  isLabelHidden?: boolean;
  /**
   * Key handling on the input itself. react-aria routes this through the
   * `TextField` root, which is the only place it can be attached — HeroUI's
   * `Form` takes no DOM handlers, so a form-level listener is not available.
   */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  /**
   * Per-field error wiring, for forms that drive validation state from
   * `fieldState` instead of handing `validationErrors` to the parent `Form`.
   * Leave both unset and react-aria resolves the message from the `Form`.
   */
  isInvalid?: boolean;
  errorMessage?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * A labelled single-line field wired for react-hook-form's `Controller`.
 *
 * HeroUI v3 fields are react-aria and controlled, so the `Controller` render
 * props map straight onto `value` / `onChange` / `onBlur`. Error presentation
 * belongs to react-aria via `FieldError` (`docs/DESIGN.md` §4.9).
 */
export const FormTextField = ({
  name,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  description,
  type,
  autoComplete,
  isRequired = false,
  isDisabled = false,
  autoFocus = false,
  isLabelHidden = false,
  onKeyDown,
  isInvalid,
  errorMessage,
  inputRef,
}: FormTextFieldProps) => {
  return (
    <TextField
      name={name}
      type={type}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      isRequired={isRequired}
      isDisabled={isDisabled}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      validationBehavior="aria"
      isInvalid={isInvalid}
      className="flex flex-col gap-1.5"
    >
      <Label className={isLabelHidden ? "sr-only" : undefined}>{label}</Label>
      <Input placeholder={placeholder} ref={inputRef} />
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
    </TextField>
  );
};
