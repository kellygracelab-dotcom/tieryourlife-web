import { useState } from "react";
import { IN_APP_BROWSER } from "../lib/inAppBrowser";
import { strings } from "../strings";
import { Button } from "../ui/Button";
import { InAppNote } from "../ui/InAppNote";
import { useSession } from "./session";
import "./SignInButton.css";

/**
 * A page's own way to sign in, as the header's Sign in behaves: greyed out
 * while the sign-in is under way, and a failure said under it rather than
 * nothing at all. In a browser inside another app the note above it already
 * says why it cannot work.
 */
export function SignInButton({ label }: { label: string }) {
  const { signIn } = useSession();
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  const press = () => {
    setState("busy");
    void signIn().then((outcome) => {
      if (outcome.kind === "redirecting") return;
      setState(outcome.kind === "failed" && outcome.code !== IN_APP_BROWSER ? "failed" : "idle");
    });
  };

  return (
    <>
      <InAppNote />
      <div className="sign-in">
        <Button variant="filled" onClick={press} disabled={state === "busy"}>
          {label}
        </Button>
        {state === "failed" && (
          <p className="sign-in__failed" role="alert">
            {strings.nav.signInFailed}
          </p>
        )}
      </div>
    </>
  );
}
