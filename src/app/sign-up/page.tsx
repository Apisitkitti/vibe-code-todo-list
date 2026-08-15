import type { Metadata } from "next";

import { redirect } from "next/navigation";

import { TODOS_PATH } from "@/lib/routes";
import { getSession } from "@/lib/session";

import { SignUpForm } from "./components/form";

export const metadata: Metadata = {
  title: "Sign up · Todos",
};

const SignUpPage = async () => {
  const session = await getSession();

  if (session?.user) {
    redirect(TODOS_PATH);
  }

  return (
    <main className="flex-1 grid place-items-center px-4 py-8">
      <SignUpForm />
    </main>
  );
};

export default SignUpPage;
