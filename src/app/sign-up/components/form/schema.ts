import { z } from "zod";

/** Copy deck: `docs/DESIGN.md` §7.9. */
const REQUIRED_FIELD_MESSAGE = "This field is required.";
const INVALID_EMAIL_MESSAGE = "Enter a valid email address.";
const PASSWORD_TOO_SHORT_MESSAGE = "Use at least 8 characters.";

/** Mirrors `emailAndPassword.minPasswordLength` in `src/lib/auth.ts`. */
export const MIN_PASSWORD_LENGTH = 8;

export const signUpFormSchema = z.object({
  name: z.string().trim().min(1, REQUIRED_FIELD_MESSAGE),
  email: z
    .string()
    .trim()
    .min(1, REQUIRED_FIELD_MESSAGE)
    .refine((value) => value.includes("@"), INVALID_EMAIL_MESSAGE),
  password: z
    .string()
    .min(1, REQUIRED_FIELD_MESSAGE)
    .min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE),
});

export type SignUpFormValues = z.infer<typeof signUpFormSchema>;
