"use client";

import type { Ref } from "react";

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
      isRequired={isRequired}
      isDisabled={isDisabled}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      validationBehavior="aria"
      isInvalid={isInvalid}
      className="flex flex-col gap-1.5"
    >
      <Label>{label}</Label>
      <Input placeholder={placeholder} ref={inputRef} />
      {description ? <Description>{description}</Description> : null}
      <FieldError>{errorMessage}</FieldError>
    </TextField>
  );
};
