import {
  Activity,
  Archive,
  CalendarClock,
  ClipboardList,
  FileCheck2,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  ReceiptText,
  Settings,
  ShieldCheck,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  group: "Utama" | "Keuangan" | "Kontrol & Laporan";
  adminOnly?: boolean;
};

export const navigationItems: NavigationItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    group: "Utama",
  },
  {
    label: "Internal Prepayment",
    href: "/internal-prepayment",
    icon: WalletCards,
    group: "Keuangan",
  },
  {
    label: "IR Operasional",
    href: "/ir-operasional",
    icon: ReceiptText,
    group: "Keuangan",
  },
  {
    label: "IR Facility Management",
    href: "/ir-facility-management",
    icon: Landmark,
    group: "Keuangan",
  },
  {
    label: "Transaction Ledger",
    href: "/transaction-ledger",
    icon: FileSpreadsheet,
    group: "Keuangan",
    adminOnly: true,
  },
  {
    label: "Reconciliation",
    href: "/reconciliation",
    icon: Activity,
    group: "Kontrol & Laporan",
    adminOnly: true,
  },
  {
    label: "Evidence Center",
    href: "/evidence-center",
    icon: FileCheck2,
    group: "Kontrol & Laporan",
  },
  {
    label: "Deadline Monitoring",
    href: "/deadline-monitoring",
    icon: CalendarClock,
    group: "Kontrol & Laporan",
    adminOnly: true,
  },
  {
    label: "Reports & Export",
    href: "/reports-export",
    icon: ClipboardList,
    group: "Kontrol & Laporan",
    adminOnly: true,
  },
  {
    label: "Monthly Closing",
    href: "/monthly-closing",
    icon: Archive,
    group: "Kontrol & Laporan",
    adminOnly: true,
  },
  {
    label: "Audit Trail",
    href: "/audit-trail",
    icon: ShieldCheck,
    group: "Kontrol & Laporan",
    adminOnly: true,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    group: "Kontrol & Laporan",
    adminOnly: true,
  },
];
