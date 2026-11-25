"use client";

import { useActionState } from "react";
import Image from "next/image";
import { saveProfileAction, type ProfileActionState } from "@/app/onboarding/actions";
import { SignatureInput } from "@/components/auth/signature-input";

export function ProfileOnboardingForm({
  displayName,
  officeId,
  signatureUrl,
}: {
  displayName: string;
  officeId: string;
  signatureUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState<ProfileActionState, FormData>(
    saveProfileAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-5">
      <label className="block space-y-1.5 text-sm font-medium text-slate-700">
        Nama lengkap
        <input
          name="display_name"
          defaultValue={displayName}
          autoComplete="name"
          required
          minLength={2}
          maxLength={120}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
        />
      </label>
      <label className="block space-y-1.5 text-sm font-medium text-slate-700">
        NIK Kantor
        <input
          name="employee_id"
          defaultValue={officeId}
          autoComplete="off"
          required
          maxLength={80}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
        />
        <span className="block text-xs font-normal text-slate-500">Masukkan NIK yang digunakan di kantor, bukan NIK KTP.</span>
      </label>
      <div className="space-y-1.5 text-sm font-medium text-slate-700">
        <p>Tanda tangan</p>
        <SignatureInput required={!signatureUrl} />
      </div>
      {signatureUrl && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-medium text-slate-600">Tanda tangan tersimpan</p>
          <Image
            src={signatureUrl}
            alt="Tanda tangan profil"
            width={224}
            height={96}
            unoptimized
            className="max-h-24 max-w-56 object-contain"
          />
        </div>
      )}
      {state.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-[#17365D] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Menyimpan profil..." : "Simpan profil"}
      </button>
    </form>
  );
}
