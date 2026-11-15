import pg from "pg";

const dbName = process.argv[2] || "syndicationx_db";
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:Postgresql123@localhost:5432/${dbName}`,
});
console.log("DB", dbName);

const deals = await pool.query(`
  SELECT f.id, f.deal_name, f.organization_id, c.name AS company
  FROM add_deal_form f
  LEFT JOIN companies c ON c.id = f.organization_id
  WHERE f.deal_name ILIKE '%stow%' OR f.deal_name ILIKE '%removal test%'
  ORDER BY f.created_at DESC
  LIMIT 10
`);
console.log("DEALS", JSON.stringify(deals.rows, null, 2));

const members = await pool.query(`
  SELECT dm.deal_id, dm.deal_member_role, dm.contact_member_id, dm.added_by,
         u.email, u.first_name, u.last_name
  FROM deal_member dm
  LEFT JOIN users u ON u.id::text = dm.contact_member_id
  WHERE dm.deal_id IN (
    SELECT id FROM add_deal_form WHERE deal_name ILIKE '%stow%'
  )
    AND dm.is_draft = false
  ORDER BY dm.deal_member_role
`);
console.log("MEMBERS", JSON.stringify(members.rows, null, 2));

await pool.end();
