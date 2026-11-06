import type { AddDealFormRow } from "../../schema/deal.schema/add-deal-form.schema.js";
import type { DealInvestorClassRow } from "../../schema/deal.schema/deal-investor-class.schema.js";
import {
  summarizeDealListMoneyByDealIds,
} from "./dealInvestment.service.js";
import {
  listInvestorClassesByDealId,
  mapInvestorClassesByDealIds,
} from "./dealInvestorClass.service.js";

function parseMoneyDigits(raw: string): number {
  const n = Number.parseFloat(String(raw ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatUsdNonZero(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export type EnrichedDealListRowFields = {
  raiseTarget: string;
  totalAccepted: string;
  totalInProgress: string;
  softCommitted: string;
  totalFunded: string;
  investmentType: string;
  propertyType: string;
};

/**
 * Fills deals-list KPI columns and investor-class-derived labels for dashboard cards.
 * Offering size = sum of investor-class offering sizes (else $0).
 * Total accepted = sum of investment commitment amounts.
 * Total in-progress = max(0, offering total − accepted) as remaining raise.
 */
function enrichedFieldsFrom(
  classes: readonly DealInvestorClassRow[],
  money: { committed: number; softCommitted: number; funded: number },
): EnrichedDealListRowFields {
  let sumOffering = 0;
  for (const c of classes) {
    sumOffering += parseMoneyDigits(String(c.offeringSize ?? ""));
  }

  const remaining = Math.max(0, sumOffering - money.committed);

  let investmentType = "";
  let propertyType = "";
  if (classes.length > 0) {
    try {
      const raw = JSON.parse(classes[0]!.advancedOptionsJson || "{}") as Record<
        string,
        unknown
      >;
      if (typeof raw.investmentType === "string" && raw.investmentType.trim()) {
        investmentType = raw.investmentType.trim();
      }
      const tags = Array.isArray(raw.assetTags)
        ? raw.assetTags.filter((x): x is string => typeof x === "string")
        : [];
      if (tags.length > 0 && tags[0]!.trim()) propertyType = tags[0]!.trim();
    } catch {
      /* ignore malformed JSON */
    }
  }

  return {
    raiseTarget: sumOffering > 0 ? formatUsdNonZero(sumOffering) : "$0",
    totalAccepted: money.committed > 0 ? formatUsdNonZero(money.committed) : "$0",
    totalInProgress: formatUsdNonZero(remaining),
    softCommitted:
      money.softCommitted > 0 ? formatUsdNonZero(money.softCommitted) : "$0",
    totalFunded: money.funded > 0 ? formatUsdNonZero(money.funded) : "$0",
    investmentType: investmentType || "—",
    propertyType: propertyType || "—",
  };
}

export async function enrichDealListRowForApi(
  row: AddDealFormRow,
): Promise<EnrichedDealListRowFields> {
  const dealId = String(row.id);
  const [classes, moneyByDealId] = await Promise.all([
    listInvestorClassesByDealId(dealId),
    summarizeDealListMoneyByDealIds([dealId]),
  ]);
  return enrichedFieldsFrom(
    classes,
    moneyByDealId.get(dealId) ?? {
      committed: 0,
      softCommitted: 0,
      funded: 0,
    },
  );
}

/**
 * Same fields as `enrichDealListRowForApi` for a whole list, using two queries instead of
 * two per deal. The deals list previously issued 2N queries here, so its response time grew
 * linearly with the number of deals in the workspace.
 */
export async function mapDealListEnrichmentByDealId(
  rows: readonly AddDealFormRow[],
): Promise<Map<string, EnrichedDealListRowFields>> {
  const byDealId = new Map<string, EnrichedDealListRowFields>();
  const dealIds = rows.map((r) => String(r.id));
  if (dealIds.length === 0) return byDealId;

  const [classesByDealId, moneyByDealId] = await Promise.all([
    mapInvestorClassesByDealIds(dealIds),
    summarizeDealListMoneyByDealIds(dealIds),
  ]);

  for (const dealId of dealIds) {
    byDealId.set(
      dealId,
      enrichedFieldsFrom(
        classesByDealId.get(dealId) ?? [],
        moneyByDealId.get(dealId) ?? {
          committed: 0,
          softCommitted: 0,
          funded: 0,
        },
      ),
    );
  }
  return byDealId;
}
