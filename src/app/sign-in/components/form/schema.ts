import { z } from "zod";

/** Copy deck: `docs/DESIGN.md` §7.9. */
const REQUIRED_FIELD_MESSAGE = "This field is required.";

export const signInFormSchema = z.object({
  email: z.string().trim().min(1, REQUIRED_FIELD_MESSAGE),
  password: z.string().min(1, REQUIRED_FIELD_MESSAGE),
});

export type SignInFormValues = z.infer<typeof signInFormSchema>;
