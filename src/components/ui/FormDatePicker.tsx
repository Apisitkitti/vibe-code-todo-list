"use client";

import {
  Calendar,
  DateField,
  DatePicker,
  Description,
  FieldError,
  Label,
} from "@heroui/react";
import type { DateValue } from "@internationalized/date";
import { parseDate } from "@internationalized/date";

import { FIELD_GROUP_STACK } from "@/lib/styles";

export interface FormDatePickerProps {
  name: string;
  label: string;
  /** `YYYY-MM-DD`, or `""` for no date. The wire format never changes. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  description?: string;
  isDisabled?: boolean;
}

/**
 * A calendar-backed date field.
 *
 * The form and the API keep passing `YYYY-MM-DD` strings; the conversion to
 * and from react-aria's `DateValue` is contained here, so swapping the widget
 * never touches the schema, the route handlers or the database.
 */
const toDateValue = (value: string): DateValue | null => {
  if (value.trim() === "") return null;

  try {
    return parseDate(value);
  } catch {
    // A half-typed or malformed value is not a crash — zod reports it.
    return null;
  }
};

export const FormDatePicker = ({
  name,
  label,
  value,
  onChange,
  onBlur,
  description,
  isDisabled = false,
}: FormDatePickerProps) => {
  return (
    <DatePicker
      name={name}
      value={toDateValue(value)}
      onChange={(date) => onChange(date ? date.toString() : "")}
      onBlur={onBlur}
      isDisabled={isDisabled}
      className={FIELD_GROUP_STACK}
    >
      <Label>{label}</Label>
      <DateField.Group fullWidth>
        <DateField.Input>
          {(segment) => <DateField.Segment segment={segment} />}
        </DateField.Input>
        <DateField.Suffix>
          <DatePicker.Trigger>
            <DatePicker.TriggerIndicator />
          </DatePicker.Trigger>
        </DateField.Suffix>
      </DateField.Group>
      {description ? <Description>{description}</Description> : null}
      <FieldError />
      <DatePicker.Popover>
        <Calendar>
          <Calendar.Header>
            <Calendar.YearPickerTrigger>
              <Calendar.YearPickerTriggerHeading />
              <Calendar.YearPickerTriggerIndicator />
            </Calendar.YearPickerTrigger>
            <Calendar.NavButton slot="previous" />
            <Calendar.NavButton slot="next" />
          </Calendar.Header>
          <Calendar.Grid>
            <Calendar.GridHeader>
              {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
            </Calendar.GridHeader>
            <Calendar.GridBody>
              {(date) => <Calendar.Cell date={date} />}
            </Calendar.GridBody>
          </Calendar.Grid>
        </Calendar>
      </DatePicker.Popover>
    </DatePicker>
  );
};
