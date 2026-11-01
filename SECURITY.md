# Security Policy

## Scope

SpendGuard is a **monitoring layer** — it reads public on-chain data and computes whether a spend pattern is approaching or has crossed a spending limit. It does **not**:

- Hold private keys or signing credentials
- Sign or submit transactions
- Move or custody funds
- Enforce spending limits (enforcement is handled by the on-chain smart account)

The security posture of this project is therefore limited to:

- **Data integrity**: ensuring that ingested events are correctly decoded and stored.
- **Alert delivery**: ensuring that breach/near-miss notifications reach their configured webhooks — and that an operator-supplied webhook URL cannot be used to make the indexer POST a signed payload somewhere it was never meant to reach. Destination policy lives in `@spendguard/sdk` (`webhook-target.ts`) and is enforced twice: at write time by `POST /api/webhooks`, and at delivery time by the dispatcher, which resolves the host, refuses any address that is not publicly routable, and re-checks every redirect hop.
- **Access control**: ensuring that the dashboard API is appropriately protected in production.

## Reporting a Vulnerability

If you discover a security vulnerability in SpendGuard, please **do not** open a public GitHub issue. Instead, report it privately using GitHub's built-in Security Advisories feature:

1. Navigate to **Settings > Security > Advisories > Report a vulnerability** for this repository (or go directly to <https://github.com/Spendguard/spendguard-app/security/advisories/new>).
2. Fill in the report form with as much detail as possible (see "What to Include in a Report" below).
3. Submit the report. It is visible only to the repository maintainers until it is either published or dismissed.

We will acknowledge receipt within 48 hours and provide an estimated timeline for a fix.

## Security Audit Status

This project has **not** undergone a professional security audit. It is provided as-is, and no independent security review has been performed; please factor this into your own risk assessment before relying on it in production.

## What to Include in a Report

- A clear description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested remediation (if applicable)

## Responsible Disclosure

We ask that you allow us reasonable time to address the issue before disclosing it publicly. We will coordinate disclosure timing with you.

## Non-Critical Reports

For non-security bugs, feature requests, and improvements, please open a standard GitHub issue.
