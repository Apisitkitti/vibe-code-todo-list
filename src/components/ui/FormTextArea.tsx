"use client";

import { Description, FieldError, Label, TextArea, TextField } from "@heroui/react";

import { FIELD_GROUP_STACK } from "@/lib/styles";

export interface FormTextAreaProps {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  description?: string;
  rows?: number;
  isDisabled?: boolean;
}

/**
 * The multi-line counterpart to `FormTextField`. `TextArea` is a standalone
 * input element in HeroUI v3, so it composes *inside* `TextField` rather than
 * replacing it.
 */
export const FormTextArea = ({
  name,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  description,
  rows = 3,
  isDisabled = false,
}: FormTextAreaProps) => {
  return (
    <TextField
      name={name}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      isDisabled={isDisabled}
      className={FIELD_GROUP_STACK}
    >
      <Label>{label}</Label>
      <TextArea rows={rows} placeholder={placeholder} />
      {description ? <Description>{description}</Description> : null}
      <FieldError />
    </TextField>
  );
};
