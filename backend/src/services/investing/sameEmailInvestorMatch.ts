/**
 * One real email is one person. A roster row whose saved address was replaced
 * with a redacted placeholder still belongs to the portal user who owns the
 * CRM contact email shown for that same name.
 *
 * Fragments compare that email to the query parameter `$1`.
 */

function realEmailOnContact(emailExpr: string): string {
  return `(
    nullif(trim(${emailExpr}), '') IS NOT NULL
    AND position('@' in lower(trim(${emailExpr}))) > 1
    AND lower(trim(${emailExpr})) NOT LIKE 'redacted%'
  )`;
}

function storedAddressUnusable(emailExpr: string): string {
  return `(
    nullif(trim(${emailExpr}), '') IS NULL
    OR lower(trim(${emailExpr})) LIKE 'redacted%'
    OR position('@' in lower(trim(${emailExpr}))) < 1
  )`;
}

function samePersonName(contactAlias: string, nameExpr: string): string {
  return `(
    nullif(trim(${nameExpr}), '') IS NOT NULL
    AND (
      lower(trim(${contactAlias}.full_name)) = lower(trim(${nameExpr}))
      OR lower(trim(concat_ws(' ', ${contactAlias}.first_name, ${contactAlias}.last_name))) = lower(trim(${nameExpr}))
    )
  )`;
}

/** Contact whose email is `$1` and whose name is the roster display name. */
function contactWithLoginEmailAndName(nameExpr: string): string {
  return `EXISTS (
    SELECT 1 FROM contact same_email_contact
    WHERE lower(trim(same_email_contact.email)) = $1
      AND ${realEmailOnContact("same_email_contact.email")}
      AND ${samePersonName("same_email_contact", nameExpr)}
  )`;
}

/** Linked portal user, when present, does not already have a different real email. */
function memberKeyHasNoOtherRealUserEmail(memberIdExpr: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM users linked_user
    WHERE linked_user.id::text = trim(both from ${memberIdExpr})
      AND ${realEmailOnContact("linked_user.email")}
      AND lower(trim(linked_user.email)) <> $1
  )`;
}

/** Linked CRM contact, when present, does not already have a different real email. */
function memberKeyHasNoOtherRealContactEmail(memberIdExpr: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM contact linked_contact
    WHERE linked_contact.id::text = trim(both from ${memberIdExpr})
      AND ${realEmailOnContact("linked_contact.email")}
      AND lower(trim(linked_contact.email)) <> $1
  )`;
}

/**
 * `deal_lp_investor` row belongs to the login email in `$1`, including when
 * the stored row email is only a redacted placeholder.
 */
export function lpInvestorRowMatchesLoginEmailSql(rowAlias: string): string {
  const memberId = `${rowAlias}.contact_member_id`;
  return `(
    (
      nullif(trim(${rowAlias}.email), '') IS NOT NULL
      AND lower(trim(${rowAlias}.email)) = $1
    )
    OR EXISTS (
      SELECT 1 FROM contact c
      WHERE c.id::text = trim(both from ${memberId})
        AND nullif(trim(c.email), '') IS NOT NULL
        AND lower(trim(c.email)) = $1
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id::text = trim(both from ${memberId})
        AND nullif(trim(u.email), '') IS NOT NULL
        AND lower(trim(u.email)) = $1
    )
    OR (
      ${storedAddressUnusable(`${rowAlias}.email`)}
      AND ${memberKeyHasNoOtherRealUserEmail(memberId)}
      AND ${memberKeyHasNoOtherRealContactEmail(memberId)}
      AND ${contactWithLoginEmailAndName(`${rowAlias}.investor_name`)}
    )
  )`;
}

/**
 * `deal_investment` row belongs to the login email in `$1`. Investment rows
 * do not store an email; a redacted linked user still matches the contact
 * email of the same display name.
 */
export function dealInvestmentRowMatchesLoginEmailSql(rowAlias: string): string {
  const memberId = `${rowAlias}.contact_id`;
  return `(
    EXISTS (
      SELECT 1 FROM contact c
      WHERE c.id::text = trim(both from ${memberId})
        AND nullif(trim(c.email), '') IS NOT NULL
        AND lower(trim(c.email)) = $1
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id::text = trim(both from ${memberId})
        AND nullif(trim(u.email), '') IS NOT NULL
        AND lower(trim(u.email)) = $1
    )
    OR (
      ${memberKeyHasNoOtherRealUserEmail(memberId)}
      AND ${memberKeyHasNoOtherRealContactEmail(memberId)}
      AND ${contactWithLoginEmailAndName(`${rowAlias}.contact_display_name`)}
    )
  )`;
}
