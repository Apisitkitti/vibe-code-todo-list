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

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormTextField } from "@/components/ui";
import { getErrorMessage } from "@/lib/getErrorMessage";
import { TODOS_PATH } from "@/lib/routes";
import { signUpWithEmail } from "@/service/auth.service";

import { signUpFormSchema, type SignUpFormValues } from "./schema";

const SIGN_UP_FAILED_TITLE = "Sign up failed";
const EMAIL_TAKEN_MESSAGE = "An account with that email already exists.";
const UNEXPECTED_ERROR_MESSAGE = "An unexpected error occurred. Try again.";
const EMAIL_TAKEN_CODE = "USER_ALREADY_EXISTS";
const EMAIL_TAKEN_STATUS = 422;
const CONFIRM_HEADING = "Create this account?";
const CONFIRM_ACTION = "Create account";
const CONFIRM_PENDING = "Creating account…";

export const SignUpForm = () => {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  // Holds the validated values between "submit" and "confirm". Non-null means
  // the confirm dialog is open (`docs/CONVENTIONS.md` → Mutation UX).
  const [pendingValues, setPendingValues] = useState<SignUpFormValues | null>(null);

  const { control, handleSubmit, resetField } = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpFormSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const onSubmit = (values: SignUpFormValues) => {
    setFormError(null);
    setPendingValues(values);
  };

  const fail = (message: string) => {
    setIsPending(false);
    setPendingValues(null);
    // Email keeps its value, password is cleared (`docs/PRD.md` US-01).
    resetField("password");
    setFormError(message);
    toast.danger(message);
  };

  const handleConfirm = async () => {
    if (!pendingValues || isPending) return;

    setIsPending(true);

    try {
      const { error } = await signUpWithEmail({
        name: pendingValues.name,
        email: pendingValues.email,
        password: pendingValues.password,
      });

      if (error) {
        const isEmailTaken =
          error.status === EMAIL_TAKEN_STATUS ||
          (typeof error.code === "string" && error.code.startsWith(EMAIL_TAKEN_CODE));

        fail(
          isEmailTaken
            ? EMAIL_TAKEN_MESSAGE
            : getErrorMessage(error, UNEXPECTED_ERROR_MESSAGE),
        );
        return;
      }

      toast.success(`Account created for “${pendingValues.email}”`);
      setPendingValues(null);
      router.replace(TODOS_PATH);
      router.refresh();
    } catch (error) {
      fail(getErrorMessage(error, UNEXPECTED_ERROR_MESSAGE));
    }
  };

  const handleConfirmOpenChange = (isOpen: boolean) => {
    // Escape / Cancel must never submit, and must not interrupt a live request.
    if (!isOpen && !isPending) setPendingValues(null);
  };

  return (
    <>
      <Card className="w-full max-w-sm">
        <Card.Header>
          <Card.Title>Create your account</Card.Title>
          <Card.Description>It takes about ten seconds.</Card.Description>
        </Card.Header>
        <Card.Content>
          <Form
            validationBehavior="aria"
            onSubmit={handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            {formError ? (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>{SIGN_UP_FAILED_TITLE}</Alert.Title>
                  <Alert.Description>{formError}</Alert.Description>
                </Alert.Content>
              </Alert>
            ) : null}

            <Controller
              control={control}
              name="name"
              render={({ field, fieldState }) => (
                <FormTextField
                  name={field.name}
                  label="Name"
                  type="text"
                  placeholder="Ada Lovelace"
                  autoComplete="name"
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
                  autoComplete="new-password"
                  description="At least 8 characters."
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
              className="min-h-11"
              isDisabled={isPending}
            >
              {isPending ? (
                <>
                  <Spinner size="sm" color="current" />
                  Creating account…
                </>
              ) : (
                "Create account"
              )}
            </Button>
          </Form>
        </Card.Content>
        <Card.Footer>
          <Typography type="body-sm" color="muted">
            Already have an account? <Link href="/sign-in">Sign in</Link>
          </Typography>
        </Card.Footer>
      </Card>

      <ConfirmDialog
        isOpen={pendingValues !== null}
        heading={CONFIRM_HEADING}
        body={`An account will be created for “${pendingValues?.email ?? ""}”.`}
        confirmLabel={CONFIRM_ACTION}
        pendingLabel={CONFIRM_PENDING}
        isPending={isPending}
        onConfirm={handleConfirm}
        onOpenChange={handleConfirmOpenChange}
      />
    </>
  );
};
