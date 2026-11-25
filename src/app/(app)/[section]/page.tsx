import { notFound } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { navigationItems } from "@/lib/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function SectionPlaceholderPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const item = navigationItems.find(
    (navigationItem) =>
      navigationItem.href !== "/" &&
      navigationItem.href.slice(1) === section,
  );

  if (!item) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-slate-500">
          Finance Administration & Accountability Management System
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          {item.label}
        </h1>
      </div>
      <Card className="border-0 shadow-sm ring-1 ring-slate-200">
        <CardHeader>
          <CardTitle>Modul belum diimplementasikan</CardTitle>
          <CardDescription>
            Bagian ini disiapkan untuk pengembangan pada part berikutnya.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <FilePlus2 aria-hidden="true" className="size-5" />
            </span>
            <p className="mt-4 text-sm font-semibold text-slate-800">
              Belum ada data
            </p>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
              Tidak ada data contoh yang ditampilkan. Fitur dan penyimpanan
              modul ini akan ditambahkan pada part selanjutnya.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
