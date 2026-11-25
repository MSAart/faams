"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  FileCheck2,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIDR } from "@/lib/format-currency";
import { formatCount, formatDateId } from "@/lib/format-number";
import type { Database } from "@/lib/supabase/database.types";

type LedgerRow = Database["public"]["Views"]["transaction_ledger"]["Row"];
type BalanceRow = Database["public"]["Views"]["reconciliation_balances"]["Row"];
type IPRecord = Database["public"]["Views"]["ip_monitoring"]["Row"];
type IRRecord = Database["public"]["Views"]["ir_monitoring"]["Row"];

type Expense = {
  id: string;
  ip_record_id: string | null;
  ir_transaction_id: string | null;
  category_id: string;
  expense_date: string;
  description: string;
  amount: number;
  ip_usage_status: string;
  status: string;
};

type DashboardData = {
  ledger: LedgerRow[];
  balances: BalanceRow[];
  ips: IPRecord[];
  irs: IRRecord[];
  expenses: Expense[];
  evidenceExpenseIds: string[];
  transactionToIR: Array<{ id: string; ir_record_id: string }>;
  categories: Array<{ id: string; name: string }>;
  today: string;
};

type DashboardFilters = {
  year: number;
  month: number | null;
  type: string;
  categoryId: string;
  status: string;
  source: string;
};

type Fact = {
  id: string;
  date: string;
  reference: string;
  description: string;
  amount: number;
  href: string;
  source: string;
};

type Series = {
  label: string;
  color: string;
  values: number[];
};

const monthNames = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];
const monthLongNames = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function cents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

function rupiah(valueInCents: number) {
  return formatIDR(valueInCents / 100);
}

function dateLabel(date: string | null) {
  return formatDateId(date);
}

function yearOf(date: string | null) {
  return date ? Number(date.slice(0, 4)) : null;
}

function monthOf(date: string | null) {
  return date ? Number(date.slice(5, 7)) : null;
}

function isInPeriod(date: string | null, filters: DashboardFilters) {
  return yearOf(date) === filters.year &&
    (filters.month === null || monthOf(date) === filters.month);
}

function recordHref(row: Pick<LedgerRow, "related_ip_id" | "related_ir_id" | "ir_type">) {
  if (row.related_ip_id && !row.related_ir_id) return `/internal-prepayment/${row.related_ip_id}`;
  if (row.related_ir_id && row.ir_type === "facility") return `/ir-facility-management/${row.related_ir_id}`;
  if (row.related_ir_id) return `/ir-operasional/${row.related_ir_id}`;
  if (row.related_ip_id) return `/internal-prepayment/${row.related_ip_id}`;
  return "/transaction-ledger";
}

function transactionKind(row: LedgerRow) {
  if (row.ir_type === "operasional") return "operasional";
  if (row.ir_type === "facility") return "facility";
  return "ip";
}

function statusMatches(status: string, selected: string) {
  return !selected || status === selected;
}

function BarChart({ labels, series }: { labels: string[]; series: Series[] }) {
  const allValues = series.flatMap((item) => item.values);
  const max = Math.max(...allValues, 1);
  const chartWidth = 760;
  const chartHeight = 210;
  const left = 44;
  const right = 12;
  const top = 14;
  const bottom = 32;
  const width = chartWidth - left - right;
  const height = chartHeight - top - bottom;
  const groupWidth = width / Math.max(labels.length, 1);
  const barWidth = Math.min(24, (groupWidth * 0.68) / Math.max(series.length, 1));

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label="Grafik batang ringkasan keuangan"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="h-56 min-w-[560px] w-full"
        >
          {[0, 0.5, 1].map((fraction) => {
            const y = top + height * (1 - fraction);
            return (
              <g key={fraction}>
                <line x1={left} x2={chartWidth - right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="3 4" />
                <text x={left - 7} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">
                  {fraction === 0 ? "0" : moneyAxis(max * fraction)}
                </text>
              </g>
            );
          })}
          {labels.map((label, index) => {
            const center = left + groupWidth * (index + 0.5);
            return (
              <g key={`${label}-${index}`}>
                {series.map((item, seriesIndex) => {
                  const value = item.values[index] ?? 0;
                  const barHeight = (value / max) * height;
                  const x = center - (series.length * barWidth) / 2 + seriesIndex * barWidth;
                  return (
                    <rect
                      key={item.label}
                      x={x + 2}
                      y={top + height - barHeight}
                      width={Math.max(barWidth - 4, 2)}
                      height={barHeight}
                      rx="3"
                      fill={item.color}
                    >
                      <title>{`${label} · ${item.label}: ${formatIDR(value)}`}</title>
                    </rect>
                  );
                })}
                <text x={center} y={chartHeight - 8} textAnchor="middle" fontSize="10" fill="#64748b">{label}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <Legend series={series} />
    </div>
  );
}

function LineChart({ labels, values }: { labels: string[]; values: number[] }) {
  const max = Math.max(...values, 1);
  const width = 760;
  const height = 210;
  const left = 44;
  const right = 12;
  const top = 14;
  const bottom = 32;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const points = values.map((value, index) => {
    const x = left + (labels.length <= 1 ? plotWidth / 2 : (plotWidth * index) / (labels.length - 1));
    const y = top + plotHeight - (value / max) * plotHeight;
    return { x, y, value };
  });

  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label="Grafik tren piutang reimbursement"
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 min-w-[560px] w-full"
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = top + plotHeight * (1 - fraction);
          return (
            <g key={fraction}>
              <line x1={left} x2={width - right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="3 4" />
              <text x={left - 7} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">
                {fraction === 0 ? "0" : moneyAxis(max * fraction)}
              </text>
            </g>
          );
        })}
        {points.length > 1 && <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#0f766e" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((point, index) => (
          <g key={`${labels[index]}-${index}`}>
            <circle cx={point.x} cy={point.y} r="4" fill="#0f766e">
              <title>{`${labels[index]}: ${formatIDR(point.value)}`}</title>
            </circle>
            <text x={point.x} y={height - 8} textAnchor="middle" fontSize="10" fill="#64748b">{labels[index]}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function moneyAxis(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}M`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}jt`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}rb`;
  return formatCount(Math.round(value));
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
      {series.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-2 text-xs text-slate-600">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function FinanceDashboard({
  data,
  initialFilters,
}: {
  data: DashboardData;
  initialFilters: DashboardFilters;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedMetric) return;
    document.getElementById("dashboard-details")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [selectedMetric]);

  const ledger = useMemo(() => data.ledger.filter((row) => {
    if (!isInPeriod(row.transaction_date, filters)) return false;
    if (filters.type && transactionKind(row) !== filters.type) return false;
    if (filters.categoryId && row.category_id !== filters.categoryId) return false;
    if (filters.status && !statusMatches(row.record_status ?? "", filters.status)) return false;
    if (filters.source && row.source_type !== filters.source) return false;
    return true;
  }), [data.ledger, filters]);
  const categoryIRIds = useMemo(() => new Set(data.ledger
    .filter((row) => row.category_id === filters.categoryId && row.related_ir_id)
    .map((row) => row.related_ir_id)), [data.ledger, filters.categoryId]);
  const historyLedger = useMemo(() => data.ledger.filter((row) => {
    if (yearOf(row.transaction_date)! > filters.year) return false;
    if (filters.type && transactionKind(row) !== filters.type) return false;
    if (filters.categoryId) {
      const isMatchingIR = Boolean(row.related_ir_id && categoryIRIds.has(row.related_ir_id));
      if (row.category_id !== filters.categoryId && !isMatchingIR) return false;
    }
    if (filters.status && !statusMatches(row.record_status ?? "", filters.status)) return false;
    if (filters.source && row.source_type !== filters.source) return false;
    return true;
  }), [data.ledger, filters, categoryIRIds]);

  const allYearLedger = useMemo(() => data.ledger.filter((row) => {
    if (yearOf(row.transaction_date) !== filters.year) return false;
    if (filters.type && transactionKind(row) !== filters.type) return false;
    if (filters.categoryId && row.category_id !== filters.categoryId) return false;
    if (filters.status && !statusMatches(row.record_status ?? "", filters.status)) return false;
    if (filters.source && row.source_type !== filters.source) return false;
    return true;
  }), [data.ledger, filters]);

  const yearRowsByExpense = useMemo(() => {
    const result = new Map<string, LedgerRow[]>();
    for (const row of allYearLedger) {
      if (!row.related_expense_id) continue;
      result.set(row.related_expense_id, [...(result.get(row.related_expense_id) ?? []), row]);
    }
    return result;
  }, [allYearLedger]);

  const filteredBalances = useMemo(() => data.balances.filter((row) => {
    if (!isInPeriod(row.activity_date, filters)) return false;
    if (filters.type && (filters.type === "ip" ? row.entity_type !== "ip" : row.entity_subtype !== filters.type)) return false;
    if (filters.status && row.record_status !== filters.status) return false;
    if (filters.source === "personal" && row.entity_type === "ip") return false;
    if (filters.source === "ip" && row.entity_type === "ir") return false;
    if (filters.categoryId) {
      const associatedRows = allYearLedger.filter((item) =>
        item.category_id === filters.categoryId &&
        (row.entity_type === "ip"
          ? item.related_ip_id === row.entity_id
          : item.related_ir_id === row.entity_id),
      );
      if (associatedRows.length === 0) return false;
    }
    return true;
  }), [data.balances, filters, allYearLedger]);

  const categoryById = useMemo(() => new Map(data.categories.map((category) => [category.id, category.name])), [data.categories]);
  const transactionToIR = useMemo(() => new Map(data.transactionToIR.map((transaction) => [transaction.id, transaction.ir_record_id])), [data.transactionToIR]);
  const evidenceExpenseIds = useMemo(() => new Set(data.evidenceExpenseIds), [data.evidenceExpenseIds]);
  const ipById = useMemo(() => new Map(data.ips.map((ip) => [ip.id, ip])), [data.ips]);
  const irById = useMemo(() => new Map(data.irs.map((ir) => [ir.id, ir])), [data.irs]);

  const ipDisbursementRows = ledger.filter((row) => row.movement_type === "disbursement" && row.source_type === "ip");
  const ipRealizationRows = ledger.filter((row) => row.movement_type === "expense" && row.source_type === "ip");
  const operationRows = ledger.filter((row) => row.movement_type === "expense" && row.ir_type === "operasional");
  const facilityRows = ledger.filter((row) => row.movement_type === "expense" && row.ir_type === "facility");
  const paidRows = ledger.filter((row) => row.movement_type === "reimbursement_received");
  const receivableRows = filteredBalances.filter((row) => row.entity_type === "ir" && row.outstanding_amount > 0);

  const unverifiedExpenses = data.expenses.filter((expense) => {
    if (expense.status !== "posted") return false;
    const irId = expense.ir_transaction_id ? transactionToIR.get(expense.ir_transaction_id) : null;
    const ip = expense.ip_record_id ? ipById.get(expense.ip_record_id) : null;
    const ir = irId ? irById.get(irId) : null;
    const missingEvidence = !evidenceExpenseIds.has(expense.id);
    if (expense.ip_usage_status !== "pending_review" && !missingEvidence) return false;
    if (!isInPeriod(expense.expense_date, filters)) return false;
    if (filters.categoryId && expense.category_id !== filters.categoryId) return false;
    if (filters.status && (ir?.status ?? ip?.status ?? "") !== filters.status) return false;
    if (filters.type === "ip" && !expense.ip_record_id) return false;
    if (filters.type === "operasional" && ir?.ir_type !== "operasional") return false;
    if (filters.type === "facility" && ir?.ir_type !== "facility") return false;
    if (filters.source === "ip" && !expense.ip_record_id && !yearRowsByExpense.get(expense.id)?.some((row) => row.source_type === "ip")) return false;
    if (filters.source === "personal" && !yearRowsByExpense.get(expense.id)?.some((row) => row.source_type === "personal")) return false;
    return true;
  });

  const factsForRows = (rows: LedgerRow[]): Fact[] => rows.map((row) => ({
    id: `${row.movement_type}-${row.transaction_id}`,
    date: row.transaction_date,
    reference: row.reference,
    description: row.description,
    amount: row.credit > 0 ? row.credit : row.debit,
    href: recordHref(row),
    source: row.funding_source,
  }));
  const factsForBalances = (rows: BalanceRow[]): Fact[] => rows.map((row) => ({
    id: `${row.entity_type}-${row.entity_id}`,
    date: row.activity_date ?? "",
    reference: row.reference_code ?? row.entity_id.slice(0, 10),
    description: row.description,
    amount: row.outstanding_amount,
    href: row.entity_type === "ip"
      ? `/internal-prepayment/${row.entity_id}`
      : row.entity_subtype === "facility"
        ? `/ir-facility-management/${row.entity_id}`
        : `/ir-operasional/${row.entity_id}`,
    source: row.entity_type === "ip" ? "Internal Prepayment" : "Piutang Personal",
  }));
  const unverifiedFacts: Fact[] = unverifiedExpenses.map((expense) => {
    const irId = expense.ir_transaction_id ? transactionToIR.get(expense.ir_transaction_id) : null;
    const ir = irId ? irById.get(irId) : null;
    const href = ir
      ? ir.ir_type === "facility" ? `/ir-facility-management/${ir.id}` : `/ir-operasional/${ir.id}`
      : expense.ip_record_id ? `/internal-prepayment/${expense.ip_record_id}` : "/evidence-center";
    return {
      id: expense.id,
      date: expense.expense_date,
      reference: ir?.reference_code ?? (expense.ip_record_id ? ipById.get(expense.ip_record_id)?.reference_code ?? "IP" : "Expense"),
      description: `${expense.description} · ${categoryById.get(expense.category_id) ?? "Kategori"}${expense.ip_usage_status === "pending_review" ? " · Perlu verifikasi" : " · Evidence belum tersedia"}`,
      amount: expense.amount,
      href,
      source: ir ? `IR ${ir.ir_type}` : "IP",
    };
  });

  const ipOutstandingRows = filteredBalances.filter((row) => row.entity_type === "ip" && row.outstanding_amount > 0);
  const detailFacts: Record<string, Fact[]> = {
    ipDisbursed: factsForRows(ipDisbursementRows),
    ipRealization: factsForRows(ipRealizationRows),
    ipOutstanding: factsForBalances(ipOutstandingRows),
    operational: factsForRows(operationRows),
    facility: factsForRows(facilityRows),
    receivable: factsForBalances(receivableRows),
    paid: factsForRows(paidRows),
    unverified: unverifiedFacts,
  };

  const total = (rows: LedgerRow[], field: "credit" | "debit") =>
    rows.reduce((sum, row) => sum + cents(row[field]), 0);
  const cards = [
    { key: "ipDisbursed", label: "Total IP Disbursed", value: rupiah(total(ipDisbursementRows, "debit")), note: "Pencairan IP pada periode", icon: WalletCards, tone: "text-blue-700 bg-blue-50" },
    { key: "ipRealization", label: "Total IP Realization", value: rupiah(total(ipRealizationRows, "credit")), note: "Pengeluaran dari sumber dana IP", icon: ArrowUpRight, tone: "text-emerald-700 bg-emerald-50" },
    { key: "ipOutstanding", label: "IP Outstanding", value: rupiah(ipOutstandingRows.reduce((sum, row) => sum + cents(row.outstanding_amount), 0)), note: "Saldo IP terkini untuk record periode", icon: CircleDollarSign, tone: "text-amber-700 bg-amber-50" },
    { key: "operational", label: "Total IR Operasional", value: rupiah(total(operationRows, "credit")), note: "Nilai expense, mixed funding dihitung sekali", icon: ReceiptText, tone: "text-slate-700 bg-slate-100" },
    { key: "facility", label: "Total IR Facility", value: rupiah(total(facilityRows, "credit")), note: "Nilai expense, mixed funding dihitung sekali", icon: ReceiptText, tone: "text-indigo-700 bg-indigo-50" },
    { key: "receivable", label: "Personal Reimbursement Receivable", value: rupiah(receivableRows.reduce((sum, row) => sum + cents(row.outstanding_amount), 0)), note: "Piutang personal belum dibayar", icon: ArrowDownLeft, tone: "text-amber-700 bg-amber-50" },
    { key: "paid", label: "Total Reimbursement Paid", value: rupiah(total(paidRows, "debit")), note: "Pembayaran diterima pada periode", icon: FileCheck2, tone: "text-emerald-700 bg-emerald-50" },
    { key: "unverified", label: "Total Unverified Transactions", value: formatCount(unverifiedExpenses.length), note: "Expense perlu verifikasi atau evidence", icon: AlertTriangle, tone: "text-red-700 bg-red-50" },
  ];

  const chartLabels = filters.month === null ? monthNames : [monthNames[filters.month - 1]];
  const chartMonths = filters.month === null ? Array.from({ length: 12 }, (_, i) => i + 1) : [filters.month];
  const sumMonth = (rows: LedgerRow[], month: number, predicate: (row: LedgerRow) => boolean, field: "debit" | "credit") =>
    rows.reduce((sum, row) => monthOf(row.transaction_date) === month && predicate(row) ? sum + cents(row[field]) : sum, 0) / 100;
  const seriesBy = (label: string, color: string, predicate: (row: LedgerRow) => boolean, field: "debit" | "credit") => ({
    label,
    color,
    values: chartMonths.map((month) => sumMonth(ledger, month, predicate, field)),
  });
  const monthlySeries: Series[] = [seriesBy("Pengeluaran", "#2563eb", (row) => row.movement_type === "expense", "credit")];
  const irComparisonSeries: Series[] = [
    seriesBy("Operasional", "#0f766e", (row) => row.movement_type === "expense" && row.ir_type === "operasional", "credit"),
    seriesBy("Facility", "#6366f1", (row) => row.movement_type === "expense" && row.ir_type === "facility", "credit"),
  ];
  const ipSeries: Series[] = [
    seriesBy("Disbursement", "#2563eb", (row) => row.movement_type === "disbursement" && row.source_type === "ip", "debit"),
    seriesBy("Realization", "#059669", (row) => row.movement_type === "expense" && row.source_type === "ip", "credit"),
  ];
  const sourceSeries: Series[] = [
    seriesBy("Personal", "#0f766e", (row) => row.movement_type === "expense" && row.source_type === "personal", "credit"),
    seriesBy("IP", "#2563eb", (row) => row.movement_type === "expense" && row.source_type === "ip", "credit"),
  ];
  const monthlyOutstanding = chartMonths.map((month) => {
    const lastDay = new Date(filters.year, month, 0).getDate();
    const cutoff = `${filters.year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const runningBalanceCents = historyLedger.reduce((sum, row) => {
      if (row.transaction_date > cutoff || !row.related_ir_id || row.source_type !== "personal") return sum;
      if (row.movement_type === "expense") return sum + cents(row.credit);
      if (row.movement_type === "reimbursement_received") return sum - cents(row.debit);
      return sum;
    }, 0);
    return Math.max(runningBalanceCents, 0) / 100;
  });

  const isActiveIP = (ip: IPRecord) => !["closed", "void", "settled"].includes(ip.status);
  const ipDeadlineRows = data.ips.filter((ip) => {
    if (!isActiveIP(ip) || !isInPeriod(ip.disbursement_date, filters)) return false;
    if (filters.type && filters.type !== "ip") return false;
    if (filters.status && ip.status !== filters.status) return false;
    if (filters.source === "personal") return false;
    if (filters.categoryId && !allYearLedger.some((row) => row.related_ip_id === ip.id && row.category_id === filters.categoryId)) return false;
    return true;
  });
  const daysUntil = (date: string | null) => date
    ? Math.ceil((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${data.today}T00:00:00Z`).getTime()) / 86_400_000)
    : null;
  const deadlineGroups = [
    { key: "ip-near-10", label: "IP mendekati target 10 HK", rows: ipDeadlineRows.filter((ip) => { const days = daysUntil(ip.target_settlement_date); return days !== null && days >= 0 && days <= 3; }), dueField: "target_settlement_date" as const, tone: "border-amber-200 bg-amber-50 text-amber-900" },
    { key: "ip-over-10", label: "IP melewati target 10 HK", rows: ipDeadlineRows.filter((ip) => { const days = daysUntil(ip.target_settlement_date); return days !== null && days < 0; }), dueField: "target_settlement_date" as const, tone: "border-red-200 bg-red-50 text-red-900" },
    { key: "ip-near-14", label: "IP mendekati deadline 14 HK", rows: ipDeadlineRows.filter((ip) => { const days = daysUntil(ip.administrative_deadline); return days !== null && days >= 0 && days <= 3; }), dueField: "administrative_deadline" as const, tone: "border-amber-200 bg-amber-50 text-amber-900" },
    { key: "ip-over-14", label: "IP melewati deadline 14 HK", rows: ipDeadlineRows.filter((ip) => { const days = daysUntil(ip.administrative_deadline); return days !== null && days < 0; }), dueField: "administrative_deadline" as const, tone: "border-red-200 bg-red-50 text-red-900" },
  ];
  const irDeadlineRecords = data.irs.filter((ir) => {
    if (["completed", "void"].includes(ir.status) || !isInPeriod(ir.submitted_on, filters)) return false;
    if (filters.type && filters.type !== ir.ir_type) return false;
    if (filters.status && ir.status !== filters.status) return false;
    if (filters.categoryId && !allYearLedger.some((row) => row.related_ir_id === ir.id && row.category_id === filters.categoryId)) return false;
    if (filters.source === "ip" && ir.personal_amount > 0 && ir.ip_amount === 0) return false;
    if (filters.source === "personal" && ir.personal_amount === 0) return false;
    return true;
  });
  const irPendingPTJB = irDeadlineRecords.filter((ir) => !["submitted", "approved"].includes(ir.ptjb_status));
  const irUnpaid = irDeadlineRecords.filter((ir) => ir.outstanding_amount > 0);

  const selectedFacts = selectedMetric ? detailFacts[selectedMetric] ?? [] : [];
  const selectedLabel = cards.find((card) => card.key === selectedMetric)?.label ??
    deadlineGroups.find((group) => group.key === selectedMetric)?.label ??
    (selectedMetric === "ir-pending-ptjb" ? "IR belum PTJB" : selectedMetric === "ir-unpaid" ? "IR belum dibayarkan" : "");
  const deadlineFacts: Record<string, Fact[]> = {
    "ir-pending-ptjb": irPendingPTJB.map((ir) => ({
      id: ir.id, date: ir.submitted_on ?? "", reference: ir.reference_code ?? ir.title,
      description: `${ir.title} · PTJB ${ir.ptjb_status}`, amount: ir.total_amount,
      href: ir.ir_type === "facility" ? `/ir-facility-management/${ir.id}` : `/ir-operasional/${ir.id}`,
      source: ir.ir_type === "facility" ? "Facility" : "Operasional",
    })),
    "ir-unpaid": irUnpaid.map((ir) => ({
      id: ir.id, date: ir.submitted_on ?? "", reference: ir.reference_code ?? ir.title,
      description: `${ir.title} · Outstanding ${formatIDR(ir.outstanding_amount)}`, amount: ir.outstanding_amount,
      href: ir.ir_type === "facility" ? `/ir-facility-management/${ir.id}` : `/ir-operasional/${ir.id}`,
      source: ir.ir_type === "facility" ? "Facility" : "Operasional",
    })),
  };
  const deadlineSelectedGroup = deadlineGroups.find((group) => group.key === selectedMetric);
  const finalSelectedFacts = selectedMetric && deadlineSelectedGroup
    ? deadlineSelectedGroup.rows.map((ip) => ({
      id: ip.id,
      date: ip[deadlineSelectedGroup.dueField] ?? "",
      reference: ip.reference_code ?? ip.title,
      description: `${ip.title} · ${deadlineSelectedGroup.label}`,
      amount: ip.unsettled_balance,
      href: `/internal-prepayment/${ip.id}`,
      source: ip.status,
    }))
    : deadlineFacts[selectedMetric ?? ""] ?? selectedFacts;

  const selectedPeriodLabel = `${filters.month ? `${monthLongNames[filters.month - 1]} ` : ""}${filters.year}`;

  return (
    <div className="space-y-7">
      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Finance administration workspace</p>
        <h1 className="mt-1 text-[25px] font-semibold tracking-[-0.03em] text-[#172B4D]">Dashboard</h1>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-5 text-slate-600">
          Monitoring keuangan dari ledger aktual. Pengeluaran mixed funding dihitung satu kali pada kategori IR dan dirinci menurut sumber dana.
        </p>
      </section>

      <Card>
        <CardHeader className="border-b border-slate-100 px-5 py-4">
          <CardTitle className="text-[15px]">Filter dashboard</CardTitle>
          <CardDescription className="text-xs">Periode: {selectedPeriodLabel}. Nilai outstanding adalah saldo record yang memiliki aktivitas pada periode terpilih.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-6">
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Tahun
            <select value={filters.year} onChange={(event) => setFilters({ ...filters, year: Number(event.target.value) })} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
              {Array.from({ length: 10 }, (_, index) => Number(data.today.slice(0, 4)) - index).map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Bulan
            <select value={filters.month ?? ""} onChange={(event) => setFilters({ ...filters, month: event.target.value ? Number(event.target.value) : null })} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
              <option value="">Semua bulan</option>
              {monthLongNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Jenis transaksi
            <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
              <option value="">Semua jenis</option>
              <option value="ip">Internal Prepayment</option>
              <option value="operasional">IR Operasional</option>
              <option value="facility">IR Facility</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Kategori
            <select value={filters.categoryId} onChange={(event) => setFilters({ ...filters, categoryId: event.target.value })} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
              <option value="">Semua kategori</option>
              {data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Status
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
              <option value="">Semua status</option>
              {[...new Set([...data.ips.map((ip) => ip.status), ...data.irs.map((ir) => ir.status)])].sort().map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Sumber dana
            <select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })} className="w-full rounded-lg border bg-white px-3 py-2 font-normal">
              <option value="">Semua sumber</option>
              <option value="personal">Personal</option>
              <option value="ip">IP</option>
            </select>
          </label>
        </CardContent>
      </Card>

      <section aria-label="Indikator kinerja utama" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button key={card.key} type="button" onClick={() => setSelectedMetric(selectedMetric === card.key ? null : card.key)} aria-pressed={selectedMetric === card.key} className="text-left">
              <Card className={`h-full transition-shadow hover:shadow-sm ${selectedMetric === card.key ? "ring-2 ring-blue-500/60" : ""}`}>
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500">{card.label}</p>
                    <p className={`mt-2 text-xl font-semibold tracking-tight tabular-nums ${card.key === "unverified" && unverifiedExpenses.length ? "text-red-700" : "text-[#172B4D]"}`}>{card.value}</p>
                    <p className="mt-1 text-xs text-slate-500">{card.note}</p>
                  </div>
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${card.tone}`}><Icon aria-hidden="true" className="size-4" /></span>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Pengeluaran bulanan" description="Pengeluaran aktual dari ledger untuk periode terpilih.">
          <BarChart labels={chartLabels} series={monthlySeries} />
        </ChartCard>
        <ChartCard title="Operasional vs Facility" description="Nominal expense IR; setiap funding allocation dihitung tepat satu kali.">
          <BarChart labels={chartLabels} series={irComparisonSeries} />
        </ChartCard>
        <ChartCard title="IP Disbursement vs Realization" description="Pencairan dan pengeluaran yang dibebankan ke saldo IP.">
          <BarChart labels={chartLabels} series={ipSeries} />
        </ChartCard>
        <ChartCard title="Sumber dana Personal vs IP" description="Bagian pengeluaran berdasarkan funding allocation aktual.">
          <BarChart labels={chartLabels} series={sourceSeries} />
        </ChartCard>
        <ChartCard title="Reimbursement Outstanding Trend" description="Saldo piutang Personal kumulatif sampai akhir setiap bulan, sesuai filter transaksi.">
          <LineChart labels={chartLabels} values={monthlyOutstanding} />
        </ChartCard>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-[17px] font-semibold tracking-tight text-[#172B4D]">Deadline & workflow monitoring</h2>
          <p className="mt-1 text-sm text-slate-500">Target IP dihitung dari kalender hari kerja dan libur terdaftar. Mendekati deadline berarti tersisa maksimal 3 hari kalender.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {deadlineGroups.map((group) => (
            <button key={group.key} type="button" onClick={() => setSelectedMetric(selectedMetric === group.key ? null : group.key)} aria-pressed={selectedMetric === group.key} className="text-left">
              <Card className={`h-full border ${group.tone} ${selectedMetric === group.key ? "ring-2 ring-primary" : ""}`}>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <span className="text-sm font-medium">{group.label}</span>
                  <span className="rounded-full bg-white/80 px-2.5 py-1 text-sm font-bold tabular-nums">{group.rows.length}</span>
                </CardContent>
              </Card>
            </button>
          ))}
          <DeadlineCount label="IR belum PTJB" count={irPendingPTJB.length} active={selectedMetric === "ir-pending-ptjb"} onClick={() => setSelectedMetric(selectedMetric === "ir-pending-ptjb" ? null : "ir-pending-ptjb")} />
          <DeadlineCount label="IR belum dibayarkan" count={irUnpaid.length} active={selectedMetric === "ir-unpaid"} onClick={() => setSelectedMetric(selectedMetric === "ir-unpaid" ? null : "ir-unpaid")} />
        </div>
      </section>

      {selectedMetric && (
        <Card id="dashboard-details">
          <CardHeader>
            <CardTitle>{selectedLabel}</CardTitle>
            <CardDescription>{formatCount(finalSelectedFacts.length)} transaksi/record pembentuk nilai KPI · klik nomor untuk membuka detail.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {finalSelectedFacts.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-500">Tidak ada transaksi pada filter ini.</p>
            ) : (
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Tanggal / referensi</th>
                      <th className="px-4 py-3 font-medium">Deskripsi</th>
                      <th className="px-4 py-3 font-medium">Sumber</th>
                      <th className="px-5 py-3 text-right font-medium">Nominal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {finalSelectedFacts.map((fact) => (
                      <tr key={fact.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-3">
                          <Link href={fact.href} className="font-semibold text-primary hover:underline">{fact.reference}</Link>
                          <p className="mt-1 text-xs text-slate-500">{dateLabel(fact.date)}</p>
                        </td>
                        <td className="max-w-md whitespace-normal px-4 py-3 text-slate-700">{fact.description}</td>
                        <td className="px-4 py-3 text-slate-600">{fact.source}</td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">{formatIDR(fact.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
    <CardHeader className="border-b border-slate-100 px-5 py-4">
      <CardTitle className="text-[15px]">{title}</CardTitle>
      <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DeadlineCount({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="text-left">
      <Card className={`h-full ${active ? "ring-2 ring-primary" : ""}`}>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700"><CalendarClock aria-hidden="true" className="size-4 text-slate-500" />{label}</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-bold tabular-nums text-slate-700">{count}</span>
        </CardContent>
      </Card>
    </button>
  );
}
