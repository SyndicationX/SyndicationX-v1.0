import {
  Activity,
  Briefcase,
  Clock,
  Download,
  LayoutGrid,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { runPool } from "@/common/hooks/useCachedResource";
import { useSearchParams } from "react-router-dom";
import { getSessionUserEmail } from "@/common/auth/sessionUserEmail";
import { filterDealListRowsVisibleToInvestors } from "@/modules/Investing/utils/investingViewerDealScope";
import { isPlatformAdmin, isSponsorWorkspaceInvestingViewer } from "@/common/auth/roleUtils";
import { TabsScrollStrip } from "@/common/components/tabs-scroll-strip/TabsScrollStrip";
import {
  dealListRowToDealRecord,
  mergeDealRecordWithInvestorsAndClasses,
  type DealRecord,
} from "@/modules/Syndication/dealsDashboardUtils";
import {
  fetchDealInvestorClasses,
  fetchDealInvestors,
  fetchDealsList,
} from "@/modules/Syndication/Deals/api/dealsApi";
import { ExportDealsModal } from "@/modules/Syndication/Deals/components/ExportDealsModal";
import { DEALS_LIST_REFETCH_EVENT } from "@/modules/Syndication/Deals/createDealFormDraftStorage";
import type { DealListRow } from "@/modules/Syndication/Deals/types/deals.types";
import {
  SyndicatingDealsSection,
  DealsSortControl,
  DealsViewToggle,
  type DealsSortKey,
} from "@/modules/Syndication/Deals/SyndicatingDealsSection";
import {
  investNowDraftSnapshotForViewer,
  investNowProgressForViewer,
} from "@/modules/Investing/pages/invest/investNowDraftUtils";
import {
  classifyInvestingDashboardDealBucket,
  classifyInvestingDashboardDealBucketForPlatformAdmin,
  isInvestingDashboardOpportunityDeal,
  type InvestingDashboardDealBucket,
  type InvestingDashboardDealsByBucket,
} from "./investingDashboardDealBucket";
import { loadRecentlyViewedDashboardDeals } from "./loadRecentlyViewedDashboardDeals";
import { mergeOpportunitiesTabDeals } from "./mergeOpportunitiesTabDeals";
import {
  isPortfolioRecentlyViewedEnabled,
  RECENTLY_VIEWED_DEALS_CHANGED_EVENT,
} from "./recentlyViewedDeals";

const INVESTING_DASH_DEALS_TAB_PARAM = "dealsTab";

function parseInvestingDashboardDealsTab(
  value: string | null,
): InvestingDashboardDealBucket {
  if (value === "active") return "active";
  if (value === "in_progress") return "in_progress";
  if (
    value === "coming_soon" ||
    value === "opportunities" ||
    value === "recently_viewed"
  ) {
    return "coming_soon";
  }
  return "all";
}

type DealsTab = InvestingDashboardDealBucket;

const TAB_IDS: Record<DealsTab, string> = {
  all: "investing-dash-deals-all",
  active: "investing-dash-deals-active",
  in_progress: "investing-dash-deals-in-progress",
  coming_soon: "investing-dash-deals-coming-soon",
};

function secTypeIs506(raw: string | null | undefined, letter: "b" | "c"): boolean {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return false;
  if (value === `506_${letter}` || value === `506${letter}`) return true;
  return new RegExp(`506\\s*\\(?\\s*${letter}\\s*\\)?`, "i").test(value);
}

/** Server already applied unset visibility: 506(c), or a 506(b) deal they are on. */
function investingRowKeptByUnsetOfferingVisibility(row: DealListRow): boolean {
  return secTypeIs506(row.secType, "c") || secTypeIs506(row.secType, "b");
}

function isDealSecType506b(raw: string | null | undefined): boolean {
  return secTypeIs506(raw, "b");
}

function mergeInvestingDashboardDealRecord(
  row: DealListRow,
  payload: Awaited<ReturnType<typeof fetchDealInvestors>>,
  classes: Awaited<ReturnType<typeof fetchDealInvestorClasses>>,
  viewerEmailNorm: string,
): DealRecord {
  const record = mergeDealRecordWithInvestorsAndClasses(
    row,
    dealListRowToDealRecord(row),
    payload,
    classes,
  );
  const progress = investNowProgressForViewer(
    payload.investors,
    viewerEmailNorm,
  );
  if (progress) record.investNowDraftProgress = progress;
  const snapshot = investNowDraftSnapshotForViewer(
    payload.investors,
    viewerEmailNorm,
  );
  if (snapshot) record.investNowResumeScope = snapshot.resumeScope;
  return record;
}

type DashboardDealEntry = {
  row: DealListRow;
  bucket: Exclude<DealsTab, "all">;
  payload: Awaited<ReturnType<typeof fetchDealInvestors>>;
  classes?: Awaited<ReturnType<typeof fetchDealInvestorClasses>>;
  record?: DealRecord;
};

let dashboardList: DealListRow[] | null = null;
let dashboardListEmail = "";
const dashboardDeals = new Map<string, DashboardDealEntry>();
let dashboardClassifyTask: Promise<void> | null = null;
/** Deals classified while this tab is open get their class list immediately. */
let dashboardOpenTab: DealsTab = "all";

function resetInvestingDashboardDealCache(): void {
  dashboardList = null;
  dashboardListEmail = "";
  dashboardDeals.clear();
  dashboardClassifyTask = null;
}

async function attachClasses(
  entry: DashboardDealEntry,
  viewerEmailNorm: string,
): Promise<void> {
  if (entry.record) return;
  const classes = await fetchDealInvestorClasses(entry.row.id);
  entry.classes = classes;
  entry.record = mergeInvestingDashboardDealRecord(
    entry.row,
    entry.payload,
    classes,
    viewerEmailNorm,
  );
}

function dashboardViewerUsesOfferingBuckets(): boolean {
  return isPlatformAdmin() || isSponsorWorkspaceInvestingViewer();
}

function lpBucketForDeal(
  row: DealListRow,
  payload: Awaited<ReturnType<typeof fetchDealInvestors>>,
  viewerEmailNorm: string,
): Exclude<DealsTab, "all"> | null {
  let bucket = classifyInvestingDashboardDealBucket(
    row,
    payload,
    viewerEmailNorm,
  );
  if (!bucket && isInvestingDashboardOpportunityDeal(row)) {
    bucket = "coming_soon";
  }
  /**
   * The deals API already applied offering visibility. A 506(c) offering,
   * or a 506(b) deal this investor is already on, must still appear when
   * they have no separate LP investment row (for example after being
   * added as a sponsor).
   */
  if (!bucket && investingRowKeptByUnsetOfferingVisibility(row)) {
    bucket = isDealSecType506b(row.secType) ? "active" : "coming_soon";
  }
  return bucket;
}

function recordsFromDashboardCache(): InvestingDashboardDealsByBucket {
  const out: InvestingDashboardDealsByBucket = {
    active: [],
    in_progress: [],
    coming_soon: [],
  };
  for (const entry of dashboardDeals.values()) {
    if (entry.record) out[entry.bucket].push(entry.record);
  }
  return out;
}

function tabIncludesBucket(tab: DealsTab, bucket: Exclude<DealsTab, "all">): boolean {
  return tab === "all" || tab === bucket;
}

async function ensureDashboardDealList(
  viewerEmailNorm: string,
): Promise<DealListRow[]> {
  if (dashboardList && dashboardListEmail === viewerEmailNorm) return dashboardList;
  const offeringBuckets = dashboardViewerUsesOfferingBuckets();
  let list = await fetchDealsList(
    offeringBuckets ? undefined : { includeParticipantDeals: true },
  );
  if (!offeringBuckets) list = filterDealListRowsVisibleToInvestors(list);
  dashboardList = list;
  dashboardListEmail = viewerEmailNorm;
  return list;
}

/** Sponsor and platform-admin cards are bucketed from the deal list, then only the open tab is loaded. */
async function loadOfferingBucketTab(
  tab: DealsTab,
  viewerEmailNorm: string,
  onProgress: () => void,
): Promise<void> {
  const list = await ensureDashboardDealList(viewerEmailNorm);
  onProgress();
  const wanted = list.filter((row) =>
    tabIncludesBucket(
      tab,
      classifyInvestingDashboardDealBucketForPlatformAdmin(row),
    ),
  );
  await runPool(wanted, 3, async (row) => {
    const existing = dashboardDeals.get(row.id);
    if (existing?.record) return;
    const bucket = classifyInvestingDashboardDealBucketForPlatformAdmin(row);
    const [payload, classes] = await Promise.all([
      fetchDealInvestors(row.id, { lpInvestorsOnly: true }),
      fetchDealInvestorClasses(row.id),
    ]);
    dashboardDeals.set(row.id, {
      row,
      bucket,
      payload,
      classes,
      record: mergeInvestingDashboardDealRecord(
        row,
        payload,
        classes,
        viewerEmailNorm,
      ),
    });
    onProgress();
  });
}

/** Investor classification. Class lists are fetched only for the tab that is open. */
function ensureLpDealsClassified(
  viewerEmailNorm: string,
  onProgress: () => void,
): Promise<void> {
  if (!viewerEmailNorm) return Promise.resolve();
  if (dashboardClassifyTask && dashboardListEmail === viewerEmailNorm) {
    return dashboardClassifyTask;
  }
  dashboardClassifyTask = (async () => {
    const list = await ensureDashboardDealList(viewerEmailNorm);
    onProgress();
    await runPool(list, 3, async (row) => {
      let entry = dashboardDeals.get(row.id);
      if (!entry) {
        const payload = await fetchDealInvestors(row.id, {
          lpInvestorsOnly: true,
        });
        const bucket = lpBucketForDeal(row, payload, viewerEmailNorm);
        if (!bucket) return;
        entry = { row, bucket, payload };
        dashboardDeals.set(row.id, entry);
      }
      if (!entry.record && tabIncludesBucket(dashboardOpenTab, entry.bucket)) {
        await attachClasses(entry, viewerEmailNorm);
      }
      onProgress();
    });
  })().catch((err) => {
    dashboardClassifyTask = null;
    throw err;
  });
  return dashboardClassifyTask;
}

async function hydrateLpTab(
  tab: DealsTab,
  viewerEmailNorm: string,
  onProgress: () => void,
): Promise<void> {
  const wanted = [...dashboardDeals.values()].filter(
    (entry) => !entry.record && tabIncludesBucket(tab, entry.bucket),
  );
  await runPool(wanted, 3, async (entry) => {
    if (entry.record || !tabIncludesBucket(dashboardOpenTab, entry.bucket)) return;
    await attachClasses(entry, viewerEmailNorm);
    onProgress();
  });
}

function dealRecordToDealListRow(record: DealRecord): DealListRow {
  return {
    id: record.id,
    dealName: record.title,
    dealType: record.dealType ?? "",
    dealStage: record.dealStage,
    totalInProgress: record.totalInProgress ?? "—",
    totalAccepted: record.totalAccepted,
    raiseTarget: record.targetAmount,
    distributions: record.totalDistributions,
    investors: record.investorCount,
    closeDateDisplay: record.closeDateDisplay ?? record.closeDate,
    createdDateDisplay: record.createdDateDisplay ?? "—",
    createdAt: record.createdAt,
    locationDisplay: record.location,
    offeringStatus: record.offeringStatus,
  };
}

function tabMeta(tab: DealsTab): {
  sectionTitle: string;
  searchPlaceholder: string;
  emptyLabel: string;
} {
  if (tab === "all") {
    return {
      sectionTitle: "All Deals",
      searchPlaceholder: "Search deals…",
      emptyLabel: "No deals in your investing scope yet.",
    };
  }
  if (tab === "active") {
    return {
      sectionTitle: "Active deals",
      searchPlaceholder: "Search active deals…",
      emptyLabel: "No active deals in your portfolio yet.",
    };
  }
  if (tab === "in_progress") {
    return {
      sectionTitle: "In progress deals",
      searchPlaceholder: "Search in progress deals…",
      emptyLabel: "No in-progress deals right now.",
    };
  }
  return {
    sectionTitle: "Opportunities",
    searchPlaceholder: "Search opportunities…",
    emptyLabel:
      "No opportunities right now. Open a shared offering to save it here.",
  };
}

export function InvestingDashboardDealsSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<DealsTab>(() =>
    parseInvestingDashboardDealsTab(
      searchParams.get(INVESTING_DASH_DEALS_TAB_PARAM),
    ),
  );
  const [reloadToken, setReloadToken] = useState(0);
  const [cacheTick, setCacheTick] = useState(0);
  const [openingTab, setOpeningTab] = useState(true);
  const viewerEmailNorm = getSessionUserEmail().trim().toLowerCase();
  const offeringBuckets = dashboardViewerUsesOfferingBuckets();
  const dealsByBucket = useMemo(() => {
    void cacheTick;
    return recordsFromDashboardCache();
  }, [cacheTick]);
  const [recentlyViewedDeals, setRecentlyViewedDeals] = useState<DealRecord[]>(
    [],
  );
  const [query, setQuery] = useState("");
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [dealsView, setDealsView] = useState<"grid" | "list">("grid");
  const [dealsSortKey, setDealsSortKey] = useState<DealsSortKey>("createdAt");

  useEffect(() => {
    let cancelled = false;
    setOpeningTab(true);
    dashboardOpenTab = activeTab;
    const bump = () => {
      if (!cancelled) setCacheTick((tick) => tick + 1);
    };
    void (async () => {
      try {
        if (offeringBuckets) {
          await loadOfferingBucketTab(activeTab, viewerEmailNorm, bump);
        } else if (viewerEmailNorm) {
          await Promise.all([
            ensureLpDealsClassified(viewerEmailNorm, bump),
            hydrateLpTab(activeTab, viewerEmailNorm, bump),
          ]);
          if (!cancelled && dashboardOpenTab === activeTab) {
            await hydrateLpTab(activeTab, viewerEmailNorm, bump);
          }
        }
      } finally {
        if (!cancelled) {
          bump();
          setOpeningTab(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, offeringBuckets, reloadToken, viewerEmailNorm]);

  useEffect(() => {
    if (openingTab) return;
    let cancelled = false;
    if (!isPortfolioRecentlyViewedEnabled()) {
      setRecentlyViewedDeals([]);
      return;
    }
    void loadRecentlyViewedDashboardDeals(
      recordsFromDashboardCache(),
      viewerEmailNorm,
    ).then((recent) => {
      if (cancelled) return;
      setRecentlyViewedDeals(recent);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, openingTab, reloadToken, viewerEmailNorm]);

  useEffect(() => {
    function reloadBuckets() {
      resetInvestingDashboardDealCache();
      setReloadToken((token) => token + 1);
    }
    window.addEventListener(DEALS_LIST_REFETCH_EVENT, reloadBuckets);
    window.addEventListener(RECENTLY_VIEWED_DEALS_CHANGED_EVENT, reloadBuckets);
    return () => {
      window.removeEventListener(DEALS_LIST_REFETCH_EVENT, reloadBuckets);
      window.removeEventListener(
        RECENTLY_VIEWED_DEALS_CHANGED_EVENT,
        reloadBuckets,
      );
    };
  }, []);

  useEffect(() => {
    const fromUrl = parseInvestingDashboardDealsTab(
      searchParams.get(INVESTING_DASH_DEALS_TAB_PARAM),
    );
    setActiveTab((prev) => (prev === fromUrl ? prev : fromUrl));
  }, [searchParams]);

  function selectDealsTab(tab: DealsTab) {
    setActiveTab(tab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "all") next.delete(INVESTING_DASH_DEALS_TAB_PARAM);
        else next.set(INVESTING_DASH_DEALS_TAB_PARAM, tab);
        return next;
      },
      { replace: true },
    );
  }

  useEffect(() => {
    setQuery("");
  }, [activeTab]);

  const classifiedCounts = useMemo(() => {
    void cacheTick;
    const counts = { active: 0, in_progress: 0, coming_soon: 0 };
    if (offeringBuckets && dashboardList) {
      for (const row of dashboardList) {
        counts[classifyInvestingDashboardDealBucketForPlatformAdmin(row)] += 1;
      }
      return counts;
    }
    for (const entry of dashboardDeals.values()) counts[entry.bucket] += 1;
    return counts;
  }, [cacheTick, offeringBuckets]);
  const activeCount = classifiedCounts.active;
  const inProgressCount = classifiedCounts.in_progress;
  const opportunityTabDeals = useMemo(
    () =>
      mergeOpportunitiesTabDeals(
        dealsByBucket.coming_soon,
        recentlyViewedDeals,
      ),
    [dealsByBucket.coming_soon, recentlyViewedDeals],
  );
  const comingSoonCount = Math.max(
    opportunityTabDeals.length,
    classifiedCounts.coming_soon,
  );
  const allCount = activeCount + inProgressCount + comingSoonCount;
  const dealsForTab = useMemo(() => {
    if (activeTab === "all") {
      return [
        ...dealsByBucket.active,
        ...dealsByBucket.in_progress,
        ...opportunityTabDeals,
      ];
    }
    if (activeTab === "coming_soon") return opportunityTabDeals;
    return dealsByBucket[activeTab];
  }, [activeTab, dealsByBucket, opportunityTabDeals]);
  const tabLoading = openingTab && dealsForTab.length === 0;
  const { sectionTitle, searchPlaceholder, emptyLabel } = tabMeta(activeTab);
  const exportDeals = useMemo(
    () => dealsForTab.map(dealRecordToDealListRow),
    [dealsForTab],
  );

  return (
    <section
      className="investing_dash_deals_section"
      aria-labelledby="investing-dash-deals-title"
    >
      <header className="investing_dash_deals_header">
        <h2
          id="investing-dash-deals-title"
          className="sponsor_dash_section_title investing_dash_deals_title"
        >
          <Briefcase
            className="investing_dash_deals_title_icon"
            size={22}
            strokeWidth={1.75}
            aria-hidden
          />
          All Investments
        </h2>
      </header>

      <div className="sponsor_dash_deals_block um_panel deals_list_card_surface deal_inv_table_panel">
        <div className="um_members_tabs_outer deals_tabs_outer um_segmented_tabs_outer investing_dash_deals_tabs">
          <TabsScrollStrip scrollClassName="deals_tabs_scroll um_segmented_tabs_scroll">
            <div
              className="um_members_tabs_row deals_tabs_row um_segmented_tabs_row"
              role="tablist"
              aria-label="All deals by status"
            >
              <button
                type="button"
                id={TAB_IDS.all}
                role="tab"
                aria-selected={activeTab === "all"}
                aria-controls="investing-dash-deals-panel"
                className={`um_members_tab deals_tabs_tab um_segmented_tab${
                  activeTab === "all" ? " um_members_tab_active" : ""
                }`}
                onClick={() => selectDealsTab("all")}
              >
                <LayoutGrid
                  className="deals_tabs_icon um_segmented_tab_icon"
                  size={16}
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="deals_tabs_label um_segmented_tab_label">
                  Investments
                </span>
                <span className="deals_tabs_count">({allCount})</span>
              </button>
              <button
                type="button"
                id={TAB_IDS.active}
                role="tab"
                aria-selected={activeTab === "active"}
                aria-controls="investing-dash-deals-panel"
                className={`um_members_tab deals_tabs_tab um_segmented_tab${
                  activeTab === "active" ? " um_members_tab_active" : ""
                }`}
                onClick={() => selectDealsTab("active")}
              >
                <Activity
                  className="deals_tabs_icon um_segmented_tab_icon"
                  size={16}
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="deals_tabs_label um_segmented_tab_label">
                  Active
                </span>
                <span className="deals_tabs_count">({activeCount})</span>
              </button>
              <button
                type="button"
                id={TAB_IDS.in_progress}
                role="tab"
                aria-selected={activeTab === "in_progress"}
                aria-controls="investing-dash-deals-panel"
                className={`um_members_tab deals_tabs_tab um_segmented_tab${
                  activeTab === "in_progress" ? " um_members_tab_active" : ""
                }`}
                onClick={() => selectDealsTab("in_progress")}
              >
                <Clock
                  className="deals_tabs_icon um_segmented_tab_icon"
                  size={16}
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="deals_tabs_label um_segmented_tab_label">
                  In progress
                </span>
                <span className="deals_tabs_count">({inProgressCount})</span>
              </button>
              {/* {comingSoonCount > 0 ? ( */}
                <button
                  type="button"
                  id={TAB_IDS.coming_soon}
                  role="tab"
                  aria-selected={activeTab === "coming_soon"}
                  aria-controls="investing-dash-deals-panel"
                  className={`um_members_tab deals_tabs_tab um_segmented_tab${
                    activeTab === "coming_soon" ? " um_members_tab_active" : ""
                  }`}
                  onClick={() => selectDealsTab("coming_soon")}
                >
                  <Sparkles
                    className="deals_tabs_icon um_segmented_tab_icon"
                    size={16}
                    strokeWidth={2}
                    aria-hidden
                  />
                  {/* <span className="deals_tabs_label um_segmented_tab_label">
                  Coming soon
                </span> */}
                  <span className="deals_tabs_label um_segmented_tab_label">
                  Opportunities
                  </span>
                  <span className="deals_tabs_count">({comingSoonCount})</span>
                </button>
              {/* ) : null} */}
            </div>
          </TabsScrollStrip>
        </div>

        <div className="investing_dash_deals_toolbar_row">
          <div className="um_toolbar deal_inv_table_um_toolbar investing_dash_deals_toolbar investing_dash_deals_unified_toolbar sponsor_dash_deals_toolbar">
            <div className="sponsor_dash_deals_toolbar_leading">
              <DealsSortControl
                sortKey={dealsSortKey}
                onSortKeyChange={setDealsSortKey}
              />
              <button
                type="button"
                className="um_toolbar_export_btn investing_dash_deals_export_btn"
                onClick={() => setExportModalOpen(true)}
                disabled={tabLoading || exportDeals.length === 0}
              >
                <Download size={18} strokeWidth={2} aria-hidden />
                <span>Export All</span>
              </button>
            </div>
            <div className="sponsor_dash_deals_toolbar_trailing">
              <DealsViewToggle view={dealsView} onViewChange={setDealsView} />
              <div className="um_search_wrap investing_dash_deals_search_wrap">
                <Search className="um_search_icon" size={18} aria-hidden />
                <input
                  type="search"
                  className="um_search_input"
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={tabLoading}
                  aria-label={searchPlaceholder}
                />
              </div>
            </div>
          </div>
        </div>

        <div
          id="investing-dash-deals-panel"
          role="tabpanel"
          aria-labelledby={TAB_IDS[activeTab]}
          className="investing_dash_deals_panel"
        >
          <SyndicatingDealsSection
            key={activeTab}
            controlledDeals={dealsForTab}
            controlledLoading={tabLoading}
            controlledQuery={query}
            onControlledQueryChange={setQuery}
            hideToolbarSearch
            hideToolbarControls
            controlledView={dealsView}
            onControlledViewChange={setDealsView}
            controlledSortKey={dealsSortKey}
            onControlledSortKeyChange={setDealsSortKey}
            dealsHeadingId="investing-deals-heading"
            hideDealsHeading
            dealsSectionTitle={sectionTitle}
            includeParticipantDeals
            filterOfferingDashboardVisibility
            investorOpportunityCards={activeTab === "coming_soon"}
            searchPlaceholder={searchPlaceholder}
            emptyStateMessage={emptyLabel}
          />
        </div>
      </div>

      <ExportDealsModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        deals={exportDeals}
      />
    </section>
  );
}
