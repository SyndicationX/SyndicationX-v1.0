/**
 * Local test data: one completed distribution on "Deal 01" with investors whose
 * bank account is Set Up (Chinmayee One — saved ACH bank on profile) and
 * Not Set Up (Contact_One Investor).
 *
 * Re-runnable: replaces the distribution with the same id.
 * Run: node --env-file=.env.local scripts/seed-deal01-distribution-bank-setup.mjs
 * Undo the bank: node --env-file=.env.local scripts/seed-deal01-distribution-bank-setup.mjs --undo
 */
import pg from "pg";

const uri = `postgresql://${process.env.DATABASE_USER ?? "postgres"}:${process.env.DATABASE_PASSWORD ?? "Postgresql123"}@${(process.env.DATABASE_HOST ?? "localhost").trim()}:${process.env.DATABASE_PORT ?? "5432"}/${process.env.DATABASE_NAME ?? "syndicationx_db"}`;

const DEAL_ID = "a9dc2ec1-e938-41ed-9833-1f87e28805f3";
const DISTRIBUTION_ID = "5d1c0b7e-8f43-4c2a-9a61-3e2f6b9d0a11";
const CLASS_ID = "f73a1bbc-8d66-4e54-a167-b739f8f4e3a3";
const CLASS_NAME = "Class A";
const TOTAL_PAYMENT = 5000;

/** Profile that gets a saved ACH bank (Set Up). */
const SET_UP_PROFILE_ID = "b02d1e84-ad15-498d-81cc-7560a3d98991";

const undo = process.argv.includes("--undo");
const pool = new pg.Pool({ connectionString: uri });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  if (undo) {
    await client.query(
      `UPDATE user_investor_profiles
         SET ach_bank_name = '', ach_routing_number = '', ach_account_number = '',
             ach_bank_account_type = ''
       WHERE id = $1`,
      [SET_UP_PROFILE_ID],
    );
    const deal = await client.query(
      `SELECT distribution_setup_json FROM add_deal_form WHERE id = $1 FOR UPDATE`,
      [DEAL_ID],
    );
    const doc = JSON.parse(deal.rows[0]?.distribution_setup_json || "{}");
    doc.priorDistributions = (doc.priorDistributions ?? []).filter(
      (d) => d.id !== DISTRIBUTION_ID,
    );
    await client.query(
      `UPDATE add_deal_form SET distribution_setup_json = $2 WHERE id = $1`,
      [DEAL_ID, JSON.stringify(doc)],
    );
    await client.query("COMMIT");
    console.log("Removed seeded distribution and saved bank.");
    process.exit(0);
  }

  const deal = await client.query(
    `SELECT deal_name, distribution_setup_json FROM add_deal_form WHERE id = $1 FOR UPDATE`,
    [DEAL_ID],
  );
  if (deal.rows.length === 0) throw new Error("Deal 01 not found");

  const inv = await client.query(
    `SELECT i.id, i.contact_id, i.commitment_amount,
            p.id AS profile_id, p.profile_name, u.email
       FROM deal_investment i
       JOIN user_investor_profiles p ON p.id = i.user_investor_profile_id
       JOIN users u ON u.id = p.user_id
      WHERE i.deal_id = $1 AND i.removed_at IS NULL
        AND i.investor_role = 'lp_investors'
      ORDER BY u.email, i.id`,
    [DEAL_ID],
  );
  if (inv.rows.length === 0) throw new Error("No linked LP investments on Deal 01");

  const capitals = inv.rows.map((r) =>
    Math.max(1, Number(String(r.commitment_amount).replace(/[^0-9.]/g, "")) || 1),
  );
  const totalCapital = capitals.reduce((s, c) => s + c, 0);
  let allocated = 0;
  const investorPayments = inv.rows.map((r, i) => {
    const share = capitals[i] / totalCapital;
    const payment =
      i === inv.rows.length - 1
        ? Math.round((TOTAL_PAYMENT - allocated) * 100) / 100
        : Math.round(TOTAL_PAYMENT * share * 100) / 100;
    allocated += payment;
    const pct = String(Math.round(share * 100 * 1000) / 1000);
    return {
      investorId: r.id,
      contactId: r.contact_id,
      userEmail: r.email,
      investorName: r.profile_name,
      classId: CLASS_ID,
      className: CLASS_NAME,
      capital: String(capitals[i]),
      percentOfClass: pct,
      percentOfDeal: pct,
      payment: String(payment),
    };
  });

  const doc = JSON.parse(deal.rows[0].distribution_setup_json || "{}");
  const others = (doc.priorDistributions ?? []).filter(
    (d) => d.id !== DISTRIBUTION_ID,
  );
  doc.priorDistributions = [
    ...others,
    {
      id: DISTRIBUTION_ID,
      name: "Q3 2026 Bank Setup Test",
      amount: String(TOTAL_PAYMENT),
      date: "2026-10-31",
      paymentDate: "2026-10-31",
      source: "operating",
      period: "quarterly",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      visible: true,
      investorPayments,
    },
  ];
  await client.query(
    `UPDATE add_deal_form SET distribution_setup_json = $2 WHERE id = $1`,
    [DEAL_ID, JSON.stringify(doc)],
  );

  // Stripe test routing / account numbers.
  await client.query(
    `UPDATE user_investor_profiles
       SET ach_bank_name = 'Test Bank (Seed)', ach_routing_number = '110000000',
           ach_account_number = '000123456789', ach_bank_account_type = 'checking'
     WHERE id = $1`,
    [SET_UP_PROFILE_ID],
  );

  await client.query("COMMIT");
  console.log(`Seeded "${deal.rows[0].deal_name}" distribution ${DISTRIBUTION_ID}`);
  console.table(
    investorPayments.map((l) => ({
      investmentId: l.investorId,
      investor: l.investorName,
      email: l.userEmail,
      payment: l.payment,
      expected:
        inv.rows.find((r) => r.id === l.investorId)?.profile_id === SET_UP_PROFILE_ID
          ? "Set Up"
          : "Not Set Up",
    })),
  );
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
  await pool.end();
}
