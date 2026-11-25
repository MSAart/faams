"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteUserAction, type InviteUserState } from "@/app/(app)/settings/user-actions";

export function UserInvitationForm() {
  const [state, formAction, pending] = useActionState<InviteUserState, FormData>(
    inviteUserAction,
    {},
  );
  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="invite-email">Email akun</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="nama@perusahaan.com"
          required
        />
      </div>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.success && <p role="status" className="text-sm text-emerald-700">{state.success}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Mengirim undangan..." : "Undang pengguna"}
      </Button>
    </form>
  );
}
