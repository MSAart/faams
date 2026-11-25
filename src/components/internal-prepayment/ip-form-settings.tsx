"use client";

import { useActionState } from "react";
import {
  saveIPApplicationSettingsAction,
  type IPFormSettingsState,
} from "@/app/(app)/settings/ip-form-actions";
import { Button } from "@/components/ui/button";
import { PasteableFileInput } from "@/components/ui/pasteable-file-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { IPApplicationFormSettings } from "@/lib/ip-application-export";

function ActionMessage({ state }: { state: IPFormSettingsState }) {
  if (state.error) {
    return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{state.error}</p>;
  }
  if (state.success) {
    return <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{state.success}</p>;
  }
  return null;
}

function ImageSetting({
  label,
  name,
  removeName,
  currentUrl,
  currentName,
}: {
  label: string;
  name: string;
  removeName: string;
  currentUrl: string | null;
  currentName: string;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-4">
      <label className="block space-y-1.5 text-sm font-medium">
        {label}
        <PasteableFileInput
          name={name}
          accept="image/png,image/jpeg"
          className="block w-full text-sm font-normal file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2"
        />
      </label>
      {currentUrl && (
        <p className="text-xs text-slate-500">
          File saat ini: <a className="font-medium text-blue-700 underline" href={currentUrl} target="_blank" rel="noreferrer">{currentName || "Lihat gambar"}</a>
        </p>
      )}
      {currentUrl && (
        <label className="flex items-center gap-2 text-xs font-normal text-slate-600">
          <input type="checkbox" name={removeName} />
          Hapus file saat ini (abaikan jika file baru diunggah)
        </label>
      )}
      <p className="text-xs text-slate-500">PNG/JPG, maksimal 5 MB.</p>
    </div>
  );
}

export function IPFormSettings({
  settings,
  imageUrls,
}: {
  settings: IPApplicationFormSettings;
  imageUrls: { logo: string | null; approverSignature: string | null };
}) {
  const [state, formAction, pending] = useActionState(saveIPApplicationSettingsAction, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Template form pengajuan IP</CardTitle>
        <CardDescription>
          Informasi ini dipakai pada export Excel dan PDF. Pengaturan bersifat privat untuk administrator.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Identitas dan kop organisasi</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium">
                Nama organisasi
                <input name="company_name" defaultValue={settings.company_name} maxLength={120} className="w-full rounded-lg border px-3 py-2 font-normal" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                Regional / unit
                <input name="regional_name" defaultValue={settings.regional_name} maxLength={160} className="w-full rounded-lg border px-3 py-2 font-normal" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                Departemen
                <input name="department_name" defaultValue={settings.department_name} maxLength={160} className="w-full rounded-lg border px-3 py-2 font-normal" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                Wilayah
                <input name="area_name" defaultValue={settings.area_name} maxLength={160} className="w-full rounded-lg border px-3 py-2 font-normal" />
              </label>
            </div>
            <ImageSetting
              label="Logo organisasi"
              name="logo"
              removeName="remove_logo"
              currentUrl={imageUrls.logo}
              currentName={settings.logo_path.split("/").at(-1) ?? ""}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Penyetuju</h2>
            <p className="text-sm leading-6 text-slate-600">
              Nama, NIK kantor, dan tanda tangan pemohon diambil dari profil masing-masing pengguna.
            </p>
            <input type="hidden" name="submitter_title" value={settings.submitter_title} />
            <input type="hidden" name="submitter_name" value={settings.submitter_name} />
            <input type="hidden" name="submitter_employee_id" value={settings.submitter_employee_id} />
            <div className="grid gap-4">
              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-medium">Menyetujui</h3>
                <label className="block space-y-1 text-sm font-medium">
                  Jabatan
                  <input name="approver_title" defaultValue={settings.approver_title} maxLength={120} className="w-full rounded-lg border px-3 py-2 font-normal" />
                </label>
                <label className="block space-y-1 text-sm font-medium">
                  Nama
                  <input name="approver_name" defaultValue={settings.approver_name} maxLength={120} className="w-full rounded-lg border px-3 py-2 font-normal" />
                </label>
                <label className="block space-y-1 text-sm font-medium">
                  Nomor pegawai
                  <input name="approver_employee_id" defaultValue={settings.approver_employee_id} maxLength={80} className="w-full rounded-lg border px-3 py-2 font-normal" />
                </label>
                <ImageSetting
                  label="Tanda tangan penyetuju"
                  name="approver_signature"
                  removeName="remove_approver_signature"
                  currentUrl={imageUrls.approverSignature}
                  currentName={settings.approver_signature_path.split("/").at(-1) ?? ""}
                />
              </div>
            </div>
          </section>
          <ActionMessage state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? "Menyimpan..." : "Simpan pengaturan template"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
