"use client";

import { Suspense } from "react";
import ResetPasswordForm from "./reset-password-form";

function ResetPasswordPageContent() {
  return <ResetPasswordForm />;
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordPageContent />
    </Suspense>
  );
}
