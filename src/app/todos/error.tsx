"use client";

import { Alert, Button } from "@heroui/react";

import { TRY_AGAIN_LABEL } from "@/app/todos/constants";

export interface TodosErrorProps {
  reset: () => void;
}

/**
 * `error` itself is deliberately not rendered: Next.js masks server messages
 * in production, and the user gets the copy deck's wording instead (§4.9).
 */
const TodosError = ({ reset }: TodosErrorProps) => {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Something went wrong</Alert.Title>
          <Alert.Description>
            An unexpected error occurred. Try again.
          </Alert.Description>
        </Alert.Content>
      </Alert>
      <Button
        variant="secondary"
        size="sm"
        className="min-h-11 self-start sm:min-h-9"
        onPress={reset}
      >
        {TRY_AGAIN_LABEL}
      </Button>
    </main>
  );
};

export default TodosError;
