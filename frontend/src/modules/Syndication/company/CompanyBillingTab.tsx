import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Check,
  CreditCard,
  Receipt,
  RotateCcw,
  Search,
} from "lucide-react";
import {
  DataTable,
  type DataTableColumn,
} from "../../../common/components/data-table/DataTable";
import { TabsScrollStrip } from "../../../common/components/tabs-scroll-strip/TabsScrollStrip";

type BillingSubTab = "pricing" | "payment-history";

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  amount: string;
};

const BILLING_PLANS = [
  {
    id: "portal",
    name: "Portal",
    tagline: "For small teams getting started",
    monthly: 27,
    annually: 272,
    featured: false,
    cta: "Choose Portal",
    sections: [
      {
        title: "Deals",
        items: [
          "5 active deals",
          "2 assets per deal",
          "1 lead sponsor per deal",
          "Deal members and LP investor records",
        ],
      },
      {
        title: "Contacts & comms",
        items: [
          "Contacts with tags and lists",
          "Bulk send email from contacts and deals",
          "5 email templates",
          "255 characters per email template body",
        ],
      },
      {
        title: "Reporting & exports",
        items: [
          "Standard syndication reporting",
          "CSV export for contacts and deal investors",
        ],
      },
      {
        title: "Support",
        items: [
          "Email support (business hours)",
          "Help center and product updates",
        ],
      },
    ] as { title: string; items: string[] }[],
    features: [
      "Up to 10 investors across deals",
      "Offering links and document sharing",
      "Company settings and email defaults",
      "Single organization workspace",
    ],
  },
  {
    id: "platform",
    name: "Platform",
    tagline: "For growing syndication businesses",
    monthly: 95,
    annually: 958,
    featured: true,
    cta: "Choose Platform",
    sections: [
      {
        title: "Deals",
        items: [
          "Unlimited active deals",
          "Unlimited assets per deal",
          "Multiple sponsors, classes, and roles",
          "Full deal member and investor lifecycle",
        ],
      },
      {
        title: "Contacts & comms",
        items: [
          "Org-wide contacts and user management",
          "10 email templates",
          "1,000 characters per email template body",
          "Branded outbound email experience",
        ],
      },
      {
        title: "Reporting & exports",
        items: [
          "Advanced deal and investor analytics",
          "Exports with audit-friendly activity trails",
          "Reporting workspace across your portfolio",
        ],
      },
      {
        title: "Support",
        items: [
          "Priority in-app and email support",
          "Faster response targets on critical issues",
        ],
      },
    ] as { title: string; items: string[] }[],
    features: [
      "Unlimited investors",
      "Advanced deal workflows and approvals",
      "Custom branding on investor-facing pages",
      "Dashboard KPIs and pipeline visibility",
      "Multi-user collaboration with roles",
    ],
  },
  {
    id: "custom",
    name: "Custom",
    tagline: "Tailored solutions for enterprises",
    monthly: null as number | null,
    annually: null as number | null,
    featured: false,
    cta: "Contact sales",
    sections: [
      {
        title: "Scale & structure",
        items: [
          "Multi-entity and complex cap table structures",
          "Higher limits for templates, attachments, and integrations",
          "Regional rollout and phased onboarding plans",
        ],
      },
      {
        title: "Security & compliance",
        items: [
          "Security questionnaires and review cycles",
          "Custom data retention and export policies",
          "Optional SSO and advanced access controls",
        ],
      },
      {
        title: "Services & success",
        items: [
          "Named customer success and solutions contacts",
          "Integration support with your CRM, data room, or KYC stack",
          "Executive business reviews and roadmap input",
        ],
      },
      {
        title: "Commercials",
        items: [
          "Volume- and commitment-based pricing",
          "Custom MSAs, SLAs, and professional services",
        ],
      },
    ] as { title: string; items: string[] }[],
    features: [
      "Everything in Platform, tuned to your policy",
      "Dedicated account manager",
      "Custom integrations and private workflows",
      "White-glove onboarding and training",
      "Enterprise-grade uptime and escalation paths",
    ],
  },
] as const;

const DEFAULT_DATE_FROM = "2025-11-09";
const DEFAULT_DATE_TO = "2026-05-09";

function formatPaymentHistoryDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${m}-${d}-${y}`;
}

function parseIsoDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function invoiceStatusClassName(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "paid") return "cp_billing_invoice_status cp_billing_invoice_status--paid";
  if (normalized === "open") return "cp_billing_invoice_status cp_billing_invoice_status--open";
  if (normalized === "overdue") {
    return "cp_billing_invoice_status cp_billing_invoice_status--overdue";
  }
  if (normalized === "void") return "cp_billing_invoice_status cp_billing_invoice_status--void";
  return "cp_billing_invoice_status";
}

function invoiceMatchesFilters(
  row: InvoiceRow,
  status: string,
  from: string,
  to: string,
): boolean {
  if (status && row.status.toLowerCase() !== status.toLowerCase()) {
    return false;
  }
  const invoiceDate = parseIsoDate(row.invoiceDate);
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);
  if (invoiceDate && fromDate && invoiceDate < fromDate) return false;
  if (invoiceDate && toDate && invoiceDate > toDate) return false;
  return true;
}

function BillingPricingPanel({
  billingCycle,
  onBillingCycleChange,
}: {
  billingCycle: "monthly" | "annually";
  onBillingCycleChange: (cycle: "monthly" | "annually") => void;
}) {
  return (
    <>
      <div className="cp_billing_header">
        <h3 className="cp_settings_billing_tab_title">Billing</h3>
        <p className="cp_billing_subtitle">
          Choose the plan that best fits your team.
        </p>
      </div>

      <div
        className="cp_billing_cycle"
        role="radiogroup"
        aria-label="Billing cycle"
      >
        <label
          className={`cp_billing_cycle_option ${
            billingCycle === "monthly" ? "cp_billing_cycle_option_active" : ""
          }`}
        >
          <input
            type="radio"
            name="cp_billing_cycle"
            value="monthly"
            checked={billingCycle === "monthly"}
            onChange={() => onBillingCycleChange("monthly")}
          />
          <span>Monthly</span>
        </label>
        <label
          className={`cp_billing_cycle_option ${
            billingCycle === "annually" ? "cp_billing_cycle_option_active" : ""
          }`}
        >
          <input
            type="radio"
            name="cp_billing_cycle"
            value="annually"
            checked={billingCycle === "annually"}
            onChange={() => onBillingCycleChange("annually")}
          />
          <span>Annually</span>
          <span className="cp_billing_cycle_save">Save 16%</span>
        </label>
      </div>

      <div className="cp_billing_plans">
        {BILLING_PLANS.map((plan) => {
          const price =
            billingCycle === "monthly" ? plan.monthly : plan.annually;
          const priceSuffix = billingCycle === "monthly" ? "/mo" : "/yr";
          const annualMonthlyEquiv =
            billingCycle === "annually" && plan.annually != null
              ? Math.round(plan.annually / 12)
              : null;
          return (
            <div
              key={plan.id}
              className={`cp_billing_plan_card ${
                plan.featured ? "cp_billing_plan_card_featured" : ""
              }`}
            >
              {plan.featured ? (
                <span className="cp_billing_plan_badge">Most popular</span>
              ) : null}
              <h4 className="cp_billing_plan_name">{plan.name}</h4>
              <p className="cp_billing_plan_tagline">{plan.tagline}</p>
              <div className="cp_billing_plan_price">
                {price === null ? (
                  <span className="cp_billing_plan_price_custom">
                    Let&apos;s talk
                  </span>
                ) : (
                  <div className="cp_billing_plan_price_main">
                    <span className="cp_billing_plan_price_amount">${price}</span>
                    <span className="cp_billing_plan_price_suffix">
                      {priceSuffix}
                    </span>
                  </div>
                )}
                {annualMonthlyEquiv != null ? (
                  <p className="cp_billing_plan_price_calc">
                    ${annualMonthlyEquiv}/mo when billed annually
                  </p>
                ) : null}
              </div>
              <div className="cp_billing_plan_body">
                {plan.sections.map((section) => (
                  <div
                    key={section.title}
                    className="cp_billing_plan_section"
                  >
                    <h5 className="cp_billing_plan_section_title">
                      {section.title}
                    </h5>
                    <ul className="cp_billing_plan_features">
                      {section.items.map((item) => (
                        <li key={item}>
                          <Check size={16} aria-hidden="true" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <ul className="cp_billing_plan_features">
                  {plan.features.map((f) => (
                    <li key={f}>
                      <Check size={16} aria-hidden="true" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                className={`cp_billing_plan_cta ${
                  plan.featured
                    ? "cp_billing_plan_cta_primary"
                    : "cp_billing_plan_cta_secondary"
                }`}
              >
                {plan.cta}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function BillingPaymentHistoryPanel() {
  const [dateFrom, setDateFrom] = useState(DEFAULT_DATE_FROM);
  const [dateTo, setDateTo] = useState(DEFAULT_DATE_TO);
  const [statusFilter, setStatusFilter] = useState("");
  const [appliedFrom, setAppliedFrom] = useState(DEFAULT_DATE_FROM);
  const [appliedTo, setAppliedTo] = useState(DEFAULT_DATE_TO);
  const [appliedStatus, setAppliedStatus] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const invoices: InvoiceRow[] = useMemo(() => [], []);

  const filteredInvoices = useMemo(
    () =>
      invoices.filter((row) =>
        invoiceMatchesFilters(row, appliedStatus, appliedFrom, appliedTo),
      ),
    [invoices, appliedFrom, appliedTo, appliedStatus],
  );

  useEffect(() => {
    setPage(1);
  }, [appliedFrom, appliedTo, appliedStatus]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [filteredInvoices.length, pageSize, page]);

  const invoicePagination = useMemo(
    () => ({
      page,
      pageSize,
      totalItems: filteredInvoices.length,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
      ariaLabel: "Payment history table pagination",
    }),
    [page, pageSize, filteredInvoices.length],
  );

  const allSelected =
    filteredInvoices.length > 0 &&
    filteredInvoices.every((row) => selectedIds.has(row.id));

  const columns: DataTableColumn<InvoiceRow>[] = useMemo(
    () => [
      {
        id: "select",
        header: (
          <input
            type="checkbox"
            className="um_table_header_select_cb"
            checked={allSelected}
            disabled={filteredInvoices.length === 0}
            onChange={() => {
              if (allSelected) {
                setSelectedIds(new Set());
                return;
              }
              setSelectedIds(new Set(filteredInvoices.map((r) => r.id)));
            }}
            aria-label="Select all invoices"
          />
        ),
        align: "center",
        thClassName: "um_th_checkbox",
        tdClassName: "um_td_checkbox",
        cell: (row) => (
          <input
            type="checkbox"
            className="um_table_row_select_cb"
            checked={selectedIds.has(row.id)}
            onChange={() => {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(row.id)) next.delete(row.id);
                else next.add(row.id);
                return next;
              });
            }}
            aria-label={`Select invoice ${row.invoiceNumber}`}
          />
        ),
      },
      {
        id: "invoiceNumber",
        header: "Invoice number",
        sortValue: (row) => row.invoiceNumber.toLowerCase(),
        tdClassName: "cp_billing_invoice_number_td",
        cell: (row) => (
          <span className="cp_billing_invoice_number">{row.invoiceNumber}</span>
        ),
      },
      {
        id: "invoiceDate",
        header: "Invoice Date",
        sortValue: (row) => row.invoiceDate,
        cell: (row) => formatPaymentHistoryDate(row.invoiceDate),
      },
      {
        id: "dueDate",
        header: "Due Date",
        sortValue: (row) => row.dueDate,
        cell: (row) => formatPaymentHistoryDate(row.dueDate),
      },
      {
        id: "status",
        header: "Status",
        sortValue: (row) => row.status.toLowerCase(),
        cell: (row) => (
          <span className={invoiceStatusClassName(row.status)}>{row.status}</span>
        ),
      },
      {
        id: "amount",
        header: "Amount",
        align: "right",
        thClassName: "deals_th_align_right",
        tdClassName: "um_td_numeric cp_billing_amount_td",
        sortValue: (row) => row.amount,
        cell: (row) => row.amount,
      },
      {
        id: "receipt",
        header: "Receipt",
        align: "center",
        thClassName: "deals_th_align_center um_th_actions",
        tdClassName: "um_td_actions cp_billing_receipt_td",
        cell: () => (
          <button
            type="button"
            className="cp_billing_receipt_btn"
            disabled
            aria-label="Download receipt (unavailable)"
            title="Receipt download coming soon"
          >
            <Receipt size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        ),
      },
    ],
    [allSelected, filteredInvoices, selectedIds],
  );

  const handleSearch = () => {
    setAppliedFrom(dateFrom);
    setAppliedTo(dateTo);
    setAppliedStatus(statusFilter);
    setSelectedIds(new Set());
    setPage(1);
  };

  const handleReset = () => {
    setDateFrom(DEFAULT_DATE_FROM);
    setDateTo(DEFAULT_DATE_TO);
    setStatusFilter("");
    setAppliedFrom(DEFAULT_DATE_FROM);
    setAppliedTo(DEFAULT_DATE_TO);
    setAppliedStatus("");
    setSelectedIds(new Set());
    setPage(1);
  };

  return (
    <div className="cp_billing_payment_history">
      <header className="cp_billing_payment_history_head">
        <h3 className="cp_billing_payment_history_title">Payment history</h3>
        <p className="cp_billing_payment_history_lead">
          Filter invoices by date and status. Download receipts when available.
        </p>
      </header>

      <section
        className="cp_billing_payment_filters_panel"
        role="search"
        aria-label="Invoice filters"
      >
        <div className="cp_billing_payment_filters_grid">
          <div className="cp_billing_filter_field cp_billing_filter_field--date">
            <label className="cp_billing_filter_label" htmlFor="cp-billing-date-from">
              <Calendar size={14} strokeWidth={2} aria-hidden />
              Invoice date
            </label>
            <div className="cp_billing_date_range">
              <input
                id="cp-billing-date-from"
                type="date"
                className="cp_billing_filter_input cp_billing_date_input"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="Invoice date from"
              />
              <span className="cp_billing_date_range_sep">to</span>
              <input
                type="date"
                className="cp_billing_filter_input cp_billing_date_input"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="Invoice date to"
              />
            </div>
          </div>

          <div className="cp_billing_filter_field">
            <label className="cp_billing_filter_label" htmlFor="cp-billing-status">
              Status
            </label>
            <select
              id="cp-billing-status"
              className="cp_billing_filter_input cp_billing_status_select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Invoice status"
            >
              <option value="">All statuses</option>
              <option value="paid">Paid</option>
              <option value="open">Open</option>
              <option value="overdue">Overdue</option>
              <option value="void">Void</option>
            </select>
          </div>
        </div>

        <div className="cp_billing_payment_filters_actions">
          <button
            type="button"
            className="um_btn_secondary cp_billing_reset_btn"
            onClick={handleReset}
          >
            <RotateCcw size={16} strokeWidth={2} aria-hidden />
            Reset filters
          </button>
          <button
            type="button"
            className="um_btn_primary cp_billing_search_btn"
            onClick={handleSearch}
          >
            <Search size={16} strokeWidth={2} aria-hidden />
            Search
          </button>
        </div>
      </section>

      <div
        className="cp_billing_outstanding_banner"
        role="status"
        aria-live="polite"
      >
        <span className="cp_billing_outstanding_icon" aria-hidden="true">
          <Check size={14} strokeWidth={2.5} />
        </span>
        <p>Your account has no outstanding invoices at this time.</p>
      </div>

      <div className="cp_billing_invoices_table_wrap deal_inv_table_panel">
        <DataTable
          columns={columns}
          rows={filteredInvoices}
          getRowKey={(row) => row.id}
          emptyLabel="No invoices found for the selected filters."
          visualVariant="members"
          membersTableClassName="um_table_members deal_inv_table"
          membersShell="default"
          initialSort={{ columnId: "invoiceDate", direction: "desc" }}
          pagination={invoicePagination}
        />
      </div>
    </div>
  );
}

export function CompanyBillingTab() {
  const [billingSubTab, setBillingSubTab] =
    useState<BillingSubTab>("pricing");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annually">(
    "monthly",
  );

  return (
    <div className="cp_settings_billing_tab">
      <div className="um_members_tabs_outer deals_tabs_outer um_segmented_tabs_outer cp_billing_subtabs_outer">
        <TabsScrollStrip scrollClassName="deals_tabs_scroll um_segmented_tabs_scroll">
          <div
            className="um_members_tabs_row deals_tabs_row um_segmented_tabs_row"
            role="tablist"
            aria-label="Billing sections"
          >
            <button
              type="button"
              id="cp-billing-subtab-pricing"
              role="tab"
              aria-selected={billingSubTab === "pricing"}
              aria-controls="cp-billing-panel-pricing"
              className={`um_members_tab deals_tabs_tab um_segmented_tab${
                billingSubTab === "pricing" ? " um_members_tab_active" : ""
              }`}
              onClick={() => setBillingSubTab("pricing")}
            >
              <CreditCard
                className="deals_tabs_icon um_segmented_tab_icon"
                size={16}
                strokeWidth={2}
                aria-hidden
              />
              <span className="deals_tabs_label um_segmented_tab_label">
                Pricing
              </span>
            </button>
            <button
              type="button"
              id="cp-billing-subtab-payment-history"
              role="tab"
              aria-selected={billingSubTab === "payment-history"}
              aria-controls="cp-billing-panel-payment-history"
              className={`um_members_tab deals_tabs_tab um_segmented_tab${
                billingSubTab === "payment-history"
                  ? " um_members_tab_active"
                  : ""
              }`}
              onClick={() => setBillingSubTab("payment-history")}
            >
              <Receipt
                className="deals_tabs_icon um_segmented_tab_icon"
                size={16}
                strokeWidth={2}
                aria-hidden
              />
              <span className="deals_tabs_label um_segmented_tab_label">
                Payment History
              </span>
            </button>
          </div>
        </TabsScrollStrip>
      </div>

      <div
        id="cp-billing-panel-pricing"
        role="tabpanel"
        aria-labelledby="cp-billing-subtab-pricing"
        hidden={billingSubTab !== "pricing"}
        className="cp_billing_subtab_panel cp_billing_subtab_panel_pricing"
      >
        {billingSubTab === "pricing" ? (
          <BillingPricingPanel
            billingCycle={billingCycle}
            onBillingCycleChange={setBillingCycle}
          />
        ) : null}
      </div>

      <div
        id="cp-billing-panel-payment-history"
        role="tabpanel"
        aria-labelledby="cp-billing-subtab-payment-history"
        hidden={billingSubTab !== "payment-history"}
        className="cp_billing_subtab_panel"
      >
        {billingSubTab === "payment-history" ? (
          <BillingPaymentHistoryPanel />
        ) : null}
      </div>
    </div>
  );
}
