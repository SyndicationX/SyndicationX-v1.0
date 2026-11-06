import { useCachedResource } from "@/common/hooks/useCachedResource"
import {
  fetchDealDistributionFundingStatus,
  type DealDistributionFundingStatus,
} from "@/modules/Investing/api/stripeInvestorPaymentsApi"
import {
  fetchDealInvestorClasses,
  fetchDealInvestors,
  fetchDealMembers,
} from "../api/dealsApi"
import { fetchDistributionSetup } from "../distribution-setup/api/distributionSetupApi"
import type {
  DistributionSetupClass,
  PriorDistributionRecord,
} from "../distribution-setup/types/distribution-setup.types"
import { fetchDealInvestorCommunicationMails } from "../tabs/investor_communication/investorCommunicationApi"
import type { DealInvestorRow } from "../types/deal-investors.types"

export function dealInvestorsTabCacheKey(dealId: string): string {
  return `deal-tab-investors:${dealId}`
}

export function dealMembersTabCacheKey(dealId: string): string {
  return `deal-tab-members:${dealId}`
}

export function dealCommunicationTabCacheKey(dealId: string): string {
  return `deal-tab-communication:${dealId}`
}

export function dealInvestorClassesCacheKey(dealId: string): string {
  return `deal-tab-classes:${dealId}`
}

export function dealDistributionsTabCacheKey(dealId: string): string {
  return `deal-tab-distributions:${dealId}`
}

export type DealDistributionsTabData = {
  priorDistributions: PriorDistributionRecord[]
  classes: DistributionSetupClass[]
  investors: DealInvestorRow[]
  dealFunding: DealDistributionFundingStatus | null
  dealName: string
}

/** Setup, roster, and bank status for the Distributions tab, in one cached read. */
export async function loadDealDistributionsTab(
  dealId: string,
): Promise<DealDistributionsTabData> {
  const [bundle, invPack, funding] = await Promise.all([
    fetchDistributionSetup(dealId),
    fetchDealInvestors(dealId, { lpInvestorsOnly: false }),
    fetchDealDistributionFundingStatus(dealId).catch(() => null),
  ])
  return {
    priorDistributions: bundle.priorDistributions ?? [],
    classes: bundle.classes ?? [],
    investors: invPack.investors ?? [],
    dealFunding: funding,
    dealName: bundle.dealName?.trim() ?? "",
  }
}

/**
 * Starts Investors, General Partners, Investor Communication, and Distributions
 * as soon as the deal id is known, so a tab opens from data already in flight.
 */
export function usePrefetchDealRosterTabs(dealId: string | undefined): void {
  const id = dealId?.trim() ?? ""
  const enabled = id.length > 0
  const investorsPrefetch = useCachedResource({
    key: dealInvestorsTabCacheKey(id || "_"),
    enabled,
    fetcher: () => fetchDealInvestors(id, { lpInvestorsOnly: true }),
  })
  useCachedResource({
    key: dealMembersTabCacheKey(id || "_"),
    enabled,
    fetcher: () => fetchDealMembers(id),
  })
  useCachedResource({
    key: dealCommunicationTabCacheKey(id || "_"),
    enabled,
    fetcher: () => fetchDealInvestorCommunicationMails(id),
  })
  useCachedResource({
    key: dealInvestorClassesCacheKey(id || "_"),
    enabled,
    fetcher: () => fetchDealInvestorClasses(id),
  })
  useCachedResource({
    key: dealDistributionsTabCacheKey(id || "_"),
    /**
     * The distributions roster is a second full investors read. Starting it
     * with the Investors tab exhausted the API and the proxy returned 502
     * for Investors. Wait until that list has arrived.
     */
    enabled: enabled && investorsPrefetch.data != null,
    fetcher: () => loadDealDistributionsTab(id),
  })
}
