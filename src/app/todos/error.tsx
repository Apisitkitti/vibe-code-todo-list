"use client";

import { Alert, Button } from "@heroui/react";

import { TRY_AGAIN_LABEL } from "@/app/todos/constants";
import { LABELLED_CONTROL_SIZING, TODOS_PAGE_SHELL } from "@/lib/styles";

export interface TodosErrorProps {
  reset: () => void;
}

/**
 * `error` itself is deliberately not rendered: Next.js masks server messages
 * in production, and the user gets the copy deck's wording instead (§4.9).
 */
const TodosError = ({ reset }: TodosErrorProps) => {
  return (
    <main className={TODOS_PAGE_SHELL}>
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
        className={`${LABELLED_CONTROL_SIZING} self-start`}
        onPress={reset}
      >
        {TRY_AGAIN_LABEL}
      </Button>
    </main>
  );
};

export default TodosError;
