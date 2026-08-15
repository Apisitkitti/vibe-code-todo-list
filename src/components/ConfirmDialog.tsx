"use client";

import type { ReactNode } from "react";

import { AlertDialog, Button, Spinner } from "@heroui/react";

const CANCEL_LABEL = "Cancel";

export interface ConfirmDialogProps {
  isOpen: boolean;
  heading: string;
  body: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  /** Destructive confirms get a danger button and focus Cancel by default. */
  isDestructive?: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * The single confirmation surface for every mutation
 * (`docs/CONVENTIONS.md` → Mutation UX).
 */
export const ConfirmDialog = ({
  isOpen,
  heading,
  body,
  confirmLabel,
  pendingLabel,
  isDestructive = false,
  isPending,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) => {
  return (
    <AlertDialog isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Backdrop
        isDismissable={false}
        isKeyboardDismissDisabled={isPending}
      >
        <AlertDialog.Container size="sm" placement="center">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status={isDestructive ? "danger" : "accent"} />
              <AlertDialog.Heading>{heading}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>{body}</AlertDialog.Body>
            <AlertDialog.Footer className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="tertiary"
                className="min-h-11 w-full sm:w-auto"
                isDisabled={isPending}
                autoFocus={isDestructive}
                onPress={() => onOpenChange(false)}
              >
                {CANCEL_LABEL}
              </Button>
              <Button
                variant={isDestructive ? "danger" : "primary"}
                className="min-h-11 w-full sm:w-auto"
                isDisabled={isPending}
                autoFocus={!isDestructive}
                onPress={onConfirm}
              >
                {isPending ? (
                  <>
                    <Spinner size="sm" color="current" />
                    {pendingLabel}
                  </>
                ) : (
                  confirmLabel
                )}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
};
