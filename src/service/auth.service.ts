import { signIn, signOut, signUp } from "@/lib/auth-client";

/**
 * Transport only. No try/catch, no reshaping, no fallbacks
 * (`docs/CONVENTIONS.md` → Services): the better-auth response is returned
 * verbatim and the calling component decides what to show.
 */

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export const signUpWithEmail = async (input: SignUpInput) => {
  return await signUp.email({
    name: input.name,
    email: input.email,
    password: input.password,
  });
};

export const signInWithEmail = async (input: SignInInput) => {
  return await signIn.email({
    email: input.email,
    password: input.password,
  });
};

export const signOutCurrentUser = async () => {
  return await signOut();
};
