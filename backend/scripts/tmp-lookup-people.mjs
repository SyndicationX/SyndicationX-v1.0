import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:Postgresql123@localhost:5432/15Nov_SyndicationX",
});

const ids = [
  "0492f744-b08e-4f3e-8c3a-24cef66a228f",
  "35fde75d-0a6e-467e-99fd-1a7fa20d202a",
  "ffb08a99-0f99-4851-981e-4e77b81f497c",
  "b2c15cb6-1678-4819-9d24-6fdd8d192064",
  "0adb9286-d7e9-4ff6-bc0f-c0bc9829c880",
  "be00e66e-b647-429a-9f06-e41a163e1a87",
];

const users = await pool.query(
  `SELECT id, email, first_name, last_name, role, organization_id
   FROM users
   WHERE id = ANY($1::uuid[])
      OR first_name ILIKE '%trevor%'
      OR last_name ILIKE '%thompson%'
      OR email ILIKE '%trevor%'
   ORDER BY first_name
   LIMIT 30`,
  [ids],
);
console.log("USERS", JSON.stringify(users.rows, null, 2));

const contacts = await pool.query(
  `SELECT id, email, first_name, last_name, full_name
   FROM contact
   WHERE id::text = ANY($1::text[])
   LIMIT 20`,
  [ids],
);
console.log(
  "CONTACTS",
  JSON.stringify(
    contacts.rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim(),
    })),
    null,
    2,
  ),
);

const sample = await pool.query(
  `SELECT investor_role, status, commitment_amount, is_draft, profile_id, investor_class
   FROM deal_investment
   WHERE deal_id = 'e9cb17b0-1fac-4257-af7f-a6879e3a90f8'
     AND removed_at IS NULL
     AND lower(investor_role) LIKE '%lp%'
   LIMIT 3`,
);
console.log("SAMPLE_INV", JSON.stringify(sample.rows, null, 2));

await pool.end();
