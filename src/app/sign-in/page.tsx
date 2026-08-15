import type { Metadata } from "next";

import { redirect } from "next/navigation";

import { TODOS_PATH, sanitiseNextPath } from "@/lib/routes";
import { getSession } from "@/lib/session";

import { SignInForm } from "./components/form";

export const metadata: Metadata = {
  title: "Sign in · Todos",
};

const SignInPage = async ({ searchParams }: PageProps<"/sign-in">) => {
  const session = await getSession();

  if (session?.user) {
    redirect(TODOS_PATH);
  }

  const params = await searchParams;

  return (
    <main className="flex-1 grid place-items-center px-4 py-8">
      <SignInForm nextPath={sanitiseNextPath(params.next) ?? TODOS_PATH} />
    </main>
  );
};

export default SignInPage;
