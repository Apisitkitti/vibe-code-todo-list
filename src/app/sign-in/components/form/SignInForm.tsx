"use client";

import { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Button,
  Card,
  Form,
  Link,
  Spinner,
  Typography,
  toast,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";

import { FormTextField } from "@/components/ui";
import { getErrorMessage } from "@/lib/getErrorMessage";
import { AUTH_CARD_SIZING, FORM_ACTION_SIZING, FORM_FIELD_STACK } from "@/lib/styles";
import { signInWithEmail } from "@/service/auth.service";

import { signInFormSchema, type SignInFormValues } from "./schema";

const SIGN_IN_FAILED_TITLE = "Sign in failed";
const INVALID_CREDENTIALS_MESSAGE = "That email and password don’t match. Try again.";
export interface SignInFormProps {
  /** Where to land after a successful sign in (`docs/PRD.md` US-02). */
  nextPath: string;
}

export const SignInForm = ({ nextPath }: SignInFormProps) => {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const { control, handleSubmit } = useForm<SignInFormValues>({
    resolver: zodResolver(signInFormSchema),
    defaultValues: { email: "", password: "" },
  });

  const fail = (message: string) => {
    setIsPending(false);
    setFormError(message);
    toast.danger(message);
  };

  /**
   * Signing in goes straight through — no confirm dialog. It creates nothing
   * and is trivially reversible by signing out, so a confirmation step would
   * only add a click to the most-repeated action in the app.
   */
  const onSubmit = async (values: SignInFormValues) => {
    if (isPending) return;

    setFormError(null);
    setIsPending(true);

    try {
      const { error } = await signInWithEmail({
        email: values.email,
        password: values.password,
      });

      if (error) {
        // Never distinguish "no such account" from "wrong password"
        // (`docs/PRD.md` US-02).
        fail(INVALID_CREDENTIALS_MESSAGE);
        return;
      }

      toast.success(`Signed in as “${values.email}”`);
      router.replace(nextPath);
      router.refresh();
    } catch (error) {
      fail(getErrorMessage(error, INVALID_CREDENTIALS_MESSAGE));
    }
  };

  return (
    <Card className={AUTH_CARD_SIZING}>
      <Card.Header>
        <Card.Title>Welcome back</Card.Title>
        <Card.Description>Sign in to see your todos.</Card.Description>
      </Card.Header>
      <Card.Content>
          <Form
            validationBehavior="aria"
            onSubmit={handleSubmit(onSubmit)}
            className={FORM_FIELD_STACK}
          >
            {formError ? (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>{SIGN_IN_FAILED_TITLE}</Alert.Title>
                  <Alert.Description>{formError}</Alert.Description>
                </Alert.Content>
              </Alert>
            ) : null}

            <Controller
              control={control}
              name="email"
              render={({ field, fieldState }) => (
                <FormTextField
                  name={field.name}
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  isRequired
                  isInvalid={fieldState.invalid}
                  errorMessage={fieldState.error?.message}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                />
              )}
            />

            <Controller
              control={control}
              name="password"
              render={({ field, fieldState }) => (
                <FormTextField
                  name={field.name}
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  isRequired
                  isInvalid={fieldState.invalid}
                  errorMessage={fieldState.error?.message}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                />
              )}
            />

            <Button
              type="submit"
              variant="primary"
              fullWidth
              className={FORM_ACTION_SIZING}
              isDisabled={isPending}
            >
              {isPending ? (
                <>
                  <Spinner size="sm" color="current" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </Form>
      </Card.Content>
      <Card.Footer>
        <Typography type="body-sm" color="muted">
          Don’t have an account? <Link href="/sign-up">Sign up</Link>
        </Typography>
      </Card.Footer>
    </Card>
  );
};
