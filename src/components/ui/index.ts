/**
 * Shared form UI. Every form in the app composes these rather than reaching
 * for HeroUI primitives directly, so field layout, description placement and
 * error presentation stay identical across screens
 * (`docs/CONVENTIONS.md` → Forms).
 *
 * Import from `@/components/ui`, never from a file inside it.
 */
export { FormTextField, type FormTextFieldProps } from "./FormTextField";
export { FormTextArea, type FormTextAreaProps } from "./FormTextArea";
export {
  FormSelect,
  type FormSelectOption,
  type FormSelectProps,
} from "./FormSelect";
export { FormDatePicker, type FormDatePickerProps } from "./FormDatePicker";
