"use client";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { FIELD_GROUP_STACK } from "@/lib/styles";

export interface FormSelectOption {
  id: string;
  label: string;
}

export interface FormSelectProps {
  name: string;
  label: string;
  value: string;
  options: readonly FormSelectOption[];
  onChange: (value: string) => void;
  onBlur?: () => void;
  isDisabled?: boolean;
}

/**
 * A labelled select. HeroUI v3's `Select` has no `.Item`; options come from a
 * `ListBox` nested in `Select.Popover`.
 */
export const FormSelect = ({
  name,
  label,
  value,
  options,
  onChange,
  onBlur,
  isDisabled = false,
}: FormSelectProps) => {
  return (
    <Select
      name={name}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key))}
      onBlur={onBlur}
      isDisabled={isDisabled}
      className={FIELD_GROUP_STACK}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id}>
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      <FieldError />
    </Select>
  );
};
