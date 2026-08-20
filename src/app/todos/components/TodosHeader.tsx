"use client";

import { useState } from "react";

import {
  Avatar,
  Dropdown,
  Header,
  ToggleButton,
  toast,
  useIsHydrated,
  useTheme,
} from "@heroui/react";
import { useRouter } from "next/navigation";

import { getErrorMessage } from "@/lib/getErrorMessage";
import { ICON_BUTTON_SIZING } from "@/lib/styles";
import { signOutCurrentUser } from "@/service/auth.service";

const SIGN_IN_PATH = "/sign-in";

const initialsOf = (name: string, email: string): string => {
  const source = name.trim() === "" ? email : name;

  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
};

const SunIcon = () => {
  return (
    <svg
      aria-hidden="true"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
};

const MoonIcon = () => {
  return (
    <svg
      aria-hidden="true"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
};

export interface TodosHeaderProps {
  userName: string;
  userEmail: string;
}

/**
 * App bar for the todos route: wordmark, theme toggle and the account menu
 * that signs the user out (`docs/PRD.md` US-03, `docs/DESIGN.md` §4.3).
 */
export const TodosHeader = ({ userName, userEmail }: TodosHeaderProps) => {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const isHydrated = useIsHydrated();
  const [isSigningOut, setIsSigningOut] = useState(false);

  // `resolvedTheme` is undefined during SSR, so the button stays theme-neutral
  // until hydration rather than mismatching (`docs/DESIGN.md` §3).
  const isDark = isHydrated && resolvedTheme === "dark";

  const handleSignOut = async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);

    try {
      await signOutCurrentUser();
      router.replace(SIGN_IN_PATH);
      router.refresh();
    } catch (error) {
      toast.danger(getErrorMessage(error, "Couldn’t sign you out. Try again."));
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <Header className="sticky top-0 z-20 border-b border-(--border) bg-(--background)/80 backdrop-blur">
      {/*
        Shares `TODOS_PAGE_SHELL`'s content width and page gutters so the header
        lines up with the content under it, but deliberately not composed from
        it: the shell interleaves its vertical rhythm (`py-6 … lg:py-8`) between
        the gutter steps, which the header does not have, so there is no
        contiguous run of classes the two can share without one of them being
        rebuilt from fragments. Change the max-width or the gutters in one and
        the other has to follow by hand.
      */}
      <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <span className="font-semibold">Todos</span>
        <div className="flex items-center gap-2">
          <ToggleButton
            variant="ghost"
            size="sm"
            isIconOnly
            className={ICON_BUTTON_SIZING}
            isSelected={isDark}
            onChange={(isSelected) => setTheme(isSelected ? "dark" : "light")}
            aria-label={
              isDark ? "Switch to light theme" : "Switch to dark theme"
            }
          >
            {isHydrated ? isDark ? <SunIcon /> : <MoonIcon /> : <span className="size-4" />}
          </ToggleButton>

          <Dropdown>
            {/* Dropdown.Trigger is the bare react-aria Button — it takes no
                HeroUI `variant`/`isIconOnly`, so it is styled directly. */}
            <Dropdown.Trigger
              aria-label="Account menu"
              className={`inline-flex items-center justify-center rounded-(--radius) ${ICON_BUTTON_SIZING}`}
            >
              <Avatar size="sm">
                <Avatar.Fallback>{initialsOf(userName, userEmail)}</Avatar.Fallback>
              </Avatar>
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu>
                <Dropdown.Section>
                  <Dropdown.Item isDisabled>{userEmail}</Dropdown.Item>
                </Dropdown.Section>
                <Dropdown.Item
                  variant="danger"
                  onAction={() => {
                    void handleSignOut();
                  }}
                >
                  Sign out
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </div>
    </Header>
  );
};
