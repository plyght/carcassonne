import { Suspense } from "react";

import { NewGameSetup } from "./setup";

export const metadata = { title: "New game" };

export default function NewGamePage() {
  return (
    <Suspense>
      <NewGameSetup />
    </Suspense>
  );
}
