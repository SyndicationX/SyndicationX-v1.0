/**
 * Decides which rows an investor-removal request may change.
 * Database writes and the audit insert happen together in the service.
 */

export const REMOVAL_REASON_MAX = 500;

export type RemovalAction = "remove_investment" | "remove_investor";

export type RemovalMutationType =
  | "soft_delete_investment"
  | "unlink_investor"
  | "soft_delete_lp"
  | "clear_lp_soft_commitment"
  | "delete_roster_member";

export type RemovalMutation = {
  type: RemovalMutationType;
  id: string;
  previous: Record<string, unknown>;
};

export type RemovalInvestment = {
  id: string;
  contactId: string;
  profileId: string;
  userInvestorProfileId: string | null;
  status: string;
  removedAt: Date | string | null;
  investorUnlinkedAt: Date | string | null;
  previous: Record<string, unknown>;
};

export type RemovalLp = {
  id: string;
  contactId: string;
  removedAt: Date | string | null;
  /** Sponsor-entered commitment on the LP roster row. */
  committedAmount: string;
  previous: Record<string, unknown>;
};

export type RemovalMember = {
  id: string;
  contactId: string;
  /** Existing rule: General Partner / deal-team roster rows stay. */
  keepBecauseCompanyUser: boolean;
  previous: Record<string, unknown>;
};

export type RemovalPlan = {
  action: RemovalAction;
  reason: string;
  actorUserId: string;
  removedContactId: string;
  removedName: string;
  removedRole: string;
  affectedIds: string[];
  mutations: RemovalMutation[];
  previousValues: {
    investments: Record<string, unknown>[];
    lpInvestors: Record<string, unknown>[];
    rosterMember: Record<string, unknown> | null;
  };
};

export type RemovalPlanResult =
  | { ok: true; plan: RemovalPlan }
  | { ok: false; status: number; message: string };

export function isSoftCommitmentStatus(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "soft committed" || s === "soft commitment";
}

export type RemovalRequestResult =
  | { ok: true; action: RemovalAction; reason: string; confirmed: true }
  | { ok: false; status: number; message: string };

export function parseRemovalRequest(body: unknown): RemovalRequestResult {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const action = String(record.action ?? "").trim();
  if (action !== "remove_investment" && action !== "remove_investor") {
    return {
      ok: false,
      status: 400,
      message: "Choose Remove Investment or Remove Investor.",
    };
  }
  const reason = String(record.reason ?? "").trim().slice(0, REMOVAL_REASON_MAX);
  if (!reason) {
    return { ok: false, status: 400, message: "A reason is required." };
  }
  if (record.confirmed !== true) {
    return {
      ok: false,
      status: 400,
      message: "Confirm this removal before continuing.",
    };
  }
  return { ok: true, action, reason, confirmed: true };
}

function contactKey(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase();
}

function commitmentIdentity(row: RemovalInvestment): string {
  const book = String(row.userInvestorProfileId ?? "").trim().toLowerCase();
  if (book) return `book:${book}`;
  const profile = String(row.profileId ?? "").trim().toLowerCase();
  if (profile) return `profile:${profile}`;
  return `row:${row.id}`;
}

function isOpenInvestment(row: RemovalInvestment): boolean {
  return !row.removedAt && !row.investorUnlinkedAt;
}

function storedCommitmentAmount(raw: string | null | undefined): number {
  const n = Number(String(raw ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** The amount shown from `deal_lp_investor.committed_amount` after the investment row is gone. */
function pushClearLpCommitment(
  mutations: RemovalMutation[],
  lp: RemovalLp | null,
  contact: string,
): void {
  if (!lp || lp.removedAt) return;
  if (contactKey(lp.contactId) !== contact) return;
  if (storedCommitmentAmount(lp.committedAmount) <= 0) return;
  if (
    mutations.some(
      (item) => item.type === "clear_lp_soft_commitment" && item.id === lp.id,
    )
  ) {
    return;
  }
  mutations.push({
    type: "clear_lp_soft_commitment",
    id: lp.id,
    previous: lp.previous,
  });
}

/**
 * Sponsor soft-commitment rows tied to one investment: same person, same
 * profile identity, status is a soft commitment, and not the selected row.
 * Other investors and other profiles are not included.
 */
export function associatedSponsorSoftCommitmentIds(
  selected: RemovalInvestment,
  rows: readonly RemovalInvestment[],
): string[] {
  const identity = commitmentIdentity(selected);
  const contact = contactKey(selected.contactId);
  return rows
    .filter((row) => row.id !== selected.id)
    .filter((row) => isOpenInvestment(row))
    .filter((row) => contactKey(row.contactId) === contact)
    .filter((row) => commitmentIdentity(row) === identity)
    .filter((row) => isSoftCommitmentStatus(row.status))
    .map((row) => row.id);
}

export function blocksLastLeadSponsorRemoval(input: {
  deletesRosterMember: boolean;
  contactId: string;
  leadContactIds: readonly string[];
}): boolean {
  if (!input.deletesRosterMember) return false;
  const contact = contactKey(input.contactId);
  if (!contact) return false;
  const leads = input.leadContactIds.map(contactKey).filter(Boolean);
  if (!leads.includes(contact)) return false;
  return leads.filter((id) => id !== contact).length < 1;
}

export type PlanInvestorRemovalInput = {
  action: RemovalAction;
  reason: string;
  confirmed: boolean;
  actorUserId: string;
  removedName: string;
  removedRole: string;
  target: { kind: "investment" | "lp"; id: string };
  investments: readonly RemovalInvestment[];
  lp: RemovalLp | null;
  member: RemovalMember | null;
  /** Investments with a payout or a succeeded/processing payment. */
  investmentIdsWithMoney: readonly string[];
};

export function planInvestorRemoval(
  input: PlanInvestorRemovalInput,
): RemovalPlanResult {
  const actorUserId = input.actorUserId.trim();
  if (!actorUserId) {
    return { ok: false, status: 401, message: "Authorization required." };
  }
  const parsed = parseRemovalRequest({
    action: input.action,
    reason: input.reason,
    confirmed: input.confirmed,
  });
  if (!parsed.ok) return parsed;

  const targetId = input.target.id.trim();
  if (!targetId) {
    return { ok: false, status: 404, message: "Investor or investment not found." };
  }

  const selected =
    input.target.kind === "investment"
      ? input.investments.find((row) => row.id === targetId) ?? null
      : null;
  if (input.target.kind === "investment" && !selected) {
    return { ok: false, status: 404, message: "Investment not found." };
  }
  if (input.target.kind === "lp" && (!input.lp || input.lp.id !== targetId)) {
    return { ok: false, status: 404, message: "Investor not found." };
  }

  const contactId =
    selected?.contactId ?? input.lp?.contactId ?? input.member?.contactId ?? "";
  const contact = contactKey(contactId);
  const sameContactInvestments = input.investments.filter(
    (row) => contactKey(row.contactId) === contact,
  );

  if (selected?.removedAt) {
    return {
      ok: false,
      status: 409,
      message: "This investment was already removed.",
    };
  }
  if (input.lp?.removedAt && input.target.kind === "lp") {
    return {
      ok: false,
      status: 409,
      message: "This investor was already removed.",
    };
  }

  const mutations: RemovalMutation[] = [];

  if (parsed.action === "remove_investment") {
    const targets = selected
      ? [selected]
      : sameContactInvestments.filter(isOpenInvestment);
    if (targets.length === 0) {
      pushClearLpCommitment(mutations, input.lp, contact);
      if (mutations.length === 0) {
        return {
          ok: false,
          status: 400,
          message: "This investor has no investment to remove.",
        };
      }
    } else {
      const removeIds = [
        ...new Set(
          targets.flatMap((row) => [
            row.id,
            ...associatedSponsorSoftCommitmentIds(row, sameContactInvestments),
          ]),
        ),
      ];
      const blocked = removeIds.filter((id) =>
        input.investmentIdsWithMoney.includes(id),
      );
      if (blocked.length > 0) {
        return {
          ok: false,
          status: 409,
          message:
            "This investment has payments or distributions and cannot be removed.",
        };
      }
      for (const id of removeIds) {
        const row = sameContactInvestments.find((item) => item.id === id);
        if (!row) continue;
        mutations.push({
          type: "soft_delete_investment",
          id,
          previous: row.previous,
        });
      }

      const removed = new Set(removeIds);
      const stillActive = sameContactInvestments.some(
        (row) => isOpenInvestment(row) && !removed.has(row.id),
      );
      if (!stillActive) pushClearLpCommitment(mutations, input.lp, contact);
    }
  } else if (!selected) {
    const active = sameContactInvestments.filter(isOpenInvestment);
    if (active.length > 0) {
      return {
        ok: false,
        status: 409,
        message:
          "This investor still has an investment on the deal. Remove that investment's association instead.",
      };
    }
    if (!input.lp || input.lp.removedAt) {
      return { ok: false, status: 404, message: "Investor not found." };
    }
    mutations.push({
      type: "soft_delete_lp",
      id: input.lp.id,
      previous: input.lp.previous,
    });
    pushMemberDeletion(mutations, input.member, contact);
  } else {
    if (selected.investorUnlinkedAt) {
      return {
        ok: false,
        status: 409,
        message: "This investor was already removed from the investment.",
      };
    }
    mutations.push({
      type: "unlink_investor",
      id: selected.id,
      previous: selected.previous,
    });
    const stillActive = sameContactInvestments.some(
      (row) => row.id !== selected.id && isOpenInvestment(row),
    );
    if (!stillActive && input.lp && !input.lp.removedAt && contactKey(input.lp.contactId) === contact) {
      mutations.push({
        type: "soft_delete_lp",
        id: input.lp.id,
        previous: input.lp.previous,
      });
    }
    if (!stillActive) pushMemberDeletion(mutations, input.member, contact);
  }

  if (mutations.length === 0) {
    return { ok: false, status: 404, message: "Investor or investment not found." };
  }

  const investmentPrevious = mutations
    .filter(
      (item) =>
        item.type === "soft_delete_investment" || item.type === "unlink_investor",
    )
    .map((item) => item.previous);
  const lpPrevious = mutations
    .filter(
      (item) =>
        item.type === "soft_delete_lp" || item.type === "clear_lp_soft_commitment",
    )
    .map((item) => item.previous);
  const memberMutation = mutations.find(
    (item) => item.type === "delete_roster_member",
  );

  return {
    ok: true,
    plan: {
      action: parsed.action,
      reason: parsed.reason,
      actorUserId,
      removedContactId: contactId.trim(),
      removedName: input.removedName.trim(),
      removedRole: input.removedRole.trim(),
      affectedIds: mutations.map((item) => item.id),
      mutations,
      previousValues: {
        investments: investmentPrevious,
        lpInvestors: lpPrevious,
        rosterMember: memberMutation?.previous ?? null,
      },
    },
  };
}

function pushMemberDeletion(
  mutations: RemovalMutation[],
  member: RemovalMember | null,
  contact: string,
): void {
  if (!member || member.keepBecauseCompanyUser) return;
  if (contactKey(member.contactId) !== contact) return;
  mutations.push({
    type: "delete_roster_member",
    id: member.id,
    previous: member.previous,
  });
}

export type RemovalUnitOfWork = {
  applyMutations: () => Promise<void>;
  writeAudit: () => Promise<void>;
};

/**
 * Runs the data change and the audit insert inside one transaction callback.
 * If the audit insert throws, the callback rejects and the caller rolls back.
 */
export async function runRemovalUnitOfWork(
  transaction: (work: () => Promise<void>) => Promise<void>,
  steps: RemovalUnitOfWork,
): Promise<void> {
  await transaction(async () => {
    await steps.applyMutations();
    await steps.writeAudit();
  });
}
