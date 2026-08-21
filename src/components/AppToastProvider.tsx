"use client";

import { Toast } from "@heroui/react";

import { appToastQueue } from "@/lib/toast";

/**
 * The toast region, bound to the app's own queue (`src/lib/toast.ts`).
 *
 * A component rather than a `queue` prop written straight into the root
 * layout, because the layout is a server component and `appToastQueue` is a
 * class instance: props cross that boundary by serialisation, and a
 * `ToastQueue` does not serialise. This is the client side of the boundary, so
 * it can import the queue directly instead of being handed it.
 *
 * `placement` stays with the region rather than moving into the queue — it is
 * a property of where toasts are drawn, and the queue knows nothing about the
 * screen.
 */
export const AppToastProvider = () => {
  return <Toast.Provider placement="bottom" queue={appToastQueue} />;
};
