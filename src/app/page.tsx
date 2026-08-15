import { redirect } from "next/navigation";

import { SIGN_IN_PATH, TODOS_PATH } from "@/lib/routes";
import { getSession } from "@/lib/session";

const HomePage = async () => {
  const session = await getSession();

  redirect(session?.user ? TODOS_PATH : SIGN_IN_PATH);
};

export default HomePage;
