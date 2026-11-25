"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createIPAction } from "@/app/(app)/internal-prepayment/actions";
import { formatIDR } from "@/lib/format-currency";
import { ResponsiveDateInput } from "@/components/ui/responsive-date-input";

type CategoryOption = {
  id: string;
  name: string;
};

type BudgetItemDraft = {
  key: number;
  category_id: string;
  description: string;
  quantity: string;
  unit_cost: string;
  notes: string;
};

export function IPRegistrationForm({
  categories,
  applicantName,
}: {
  categories: CategoryOption[];
  applicantName: string;
}) {
  const [state, formAction, pending] = useActionState(createIPAction, {});
  const [items, setItems] = useState<BudgetItemDraft[]>([
    {
      key: 0,
      category_id: categories[0]?.id ?? "",
      description: "",
      quantity: "1",
      unit_cost: "",
      notes: "",
    },
  ]);
  const total = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_cost) || 0), 0),
    [items],
  );

  function updateItem(key: number, patch: Partial<BudgetItemDraft>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ajukan Internal Prepayment</CardTitle>
        <CardDescription>
          Isi kegiatan, PIC, dan rincian anggaran. Nomor IP resmi diisi setelah diberikan oleh admin.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              Nama kegiatan
              <input
                name="title"
                required
                maxLength={200}
                className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Tanggal pengajuan
              <ResponsiveDateInput
                name="requested_on"
                required
                className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Departemen / area
              <input
                name="department_area"
                maxLength={120}
                className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Pelaksana / PIC
              <input type="hidden" name="pic_name" value={applicantName} />
              <input
                value={applicantName}
                readOnly
                className="w-full rounded-lg border bg-slate-50 px-3 py-2 font-normal text-slate-600"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Tanggal mulai pekerjaan
              <ResponsiveDateInput
                name="project_start_date"
                className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Tanggal selesai pekerjaan
              <ResponsiveDateInput
                name="project_end_date"
                className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Lokasi project
              <input
                name="project_location"
                maxLength={200}
                className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Tujuan penggunaan
              <textarea
                name="purpose"
                required
                maxLength={1000}
                rows={2}
                className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
              />
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Item anggaran</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setItems((current) => [
                    ...current,
                    {
                      key: Math.max(-1, ...current.map((item) => item.key)) + 1,
                      category_id: categories[0]?.id ?? "",
                      description: "",
                      quantity: "1",
                      unit_cost: "",
                      notes: "",
                    },
                  ])
                }
              >
                <Plus aria-hidden="true" />
                Tambah item
              </Button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-2.5">Kategori</th>
                    <th scope="col" className="px-3 py-2.5">Item kebutuhan</th>
                    <th scope="col" className="w-24 px-3 py-2.5">Kuantitas</th>
                    <th scope="col" className="w-40 px-3 py-2.5">Biaya satuan</th>
                    <th scope="col" className="px-3 py-2.5">Catatan</th>
                    <th scope="col" className="w-36 px-3 py-2.5 text-right">Subtotal</th>
                    <th scope="col" className="w-12 px-2 py-2.5"><span className="sr-only">Aksi</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {items.map((item, index) => (
                    <tr key={item.key} className="align-middle">
                      <td className="min-w-40 px-3 py-2">
                        <select
                          aria-label={`Kategori item ${index + 1}`}
                          value={item.category_id}
                          onChange={(event) => updateItem(item.key, { category_id: event.target.value })}
                          required
                          className="w-full rounded-md border bg-white px-2 py-1.5 text-xs font-normal"
                        >
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>{category.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="min-w-56 px-3 py-2">
                        <input
                          aria-label={`Item kebutuhan ${index + 1}`}
                          value={item.description}
                          onChange={(event) => updateItem(item.key, { description: event.target.value })}
                          required
                          maxLength={200}
                          className="w-full rounded-md border bg-white px-2 py-1.5 text-xs font-normal"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          aria-label={`Kuantitas item ${index + 1}`}
                          value={item.quantity}
                          onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                          className="w-full rounded-md border bg-white px-2 py-1.5 text-xs font-normal"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          aria-label={`Biaya satuan item ${index + 1}`}
                          value={item.unit_cost}
                          onChange={(event) => updateItem(item.key, { unit_cost: event.target.value })}
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                          className="w-full rounded-md border bg-white px-2 py-1.5 text-xs font-normal"
                        />
                      </td>
                      <td className="min-w-44 px-3 py-2">
                        <input
                          aria-label={`Catatan item ${index + 1}`}
                          value={item.notes}
                          onChange={(event) => updateItem(item.key, { notes: event.target.value })}
                          maxLength={500}
                          className="w-full rounded-md border bg-white px-2 py-1.5 text-xs font-normal"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-slate-700">
                        {formatIDR((Number(item.quantity) || 0) * (Number(item.unit_cost) || 0))}
                      </td>
                      <td className="px-2 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Hapus item ${index + 1}`}
                          disabled={items.length === 1}
                          onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}
                          className="text-slate-500 hover:text-red-700"
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50">
                  <tr>
                    <th colSpan={5} scope="row" className="px-3 py-2.5 text-right font-semibold text-slate-700">Total pengajuan</th>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-[#172B4D]">{formatIDR(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <input
              type="hidden"
              name="budget_items"
              value={JSON.stringify(
                items.map(({ category_id, description, quantity, unit_cost, notes }) => ({
                  category_id,
                  description,
                  quantity: Number(quantity),
                  unit_cost: Number(unit_cost),
                  notes,
                })),
              )}
            />
          </div>

          <label className="block space-y-1.5 text-sm font-medium">
            Catatan pengajuan
            <textarea
              name="notes"
              rows={2}
              maxLength={2000}
              className="w-full rounded-lg border bg-white px-3 py-2 font-normal"
            />
          </label>

          {state.error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {state.error}
            </p>
          )}
          {state.success && (
            <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              {state.success}{" "}
              {state.createdId && (
                <Link
                  className="font-semibold underline"
                  href={`/internal-prepayment/${state.createdId}`}
                >
                  Buka detail IP
                </Link>
              )}
            </p>
          )}
          <Button type="submit" disabled={pending || categories.length === 0}>
            {pending ? "Menyimpan..." : "Simpan pengajuan"}
          </Button>
          {categories.length === 0 && (
            <p className="text-sm text-amber-700">
              Tidak ada kategori aktif. Tambahkan kategori sebelum membuat IP.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
