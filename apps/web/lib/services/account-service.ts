import postgres from "postgres";
import {
  TreasuryAccount,
  AccountType,
  AccountStatus,
  AccountRole,
  AccountMember,
  SpendingPolicy,
  Budget,
  MultiSigProposal,
  AuditLog,
  AccountSettings,
  hasPermission,
  isValidStellarAddress,
} from "@spendguard/sdk";

// ── In-Memory Fallback Store for scaling & DB independence ────────────

class MemoryStore {
  accounts: Map<string, TreasuryAccount> = new Map();
  members: Map<string, AccountMember[]> = new Map(); // accountId -> members
  policies: Map<string, SpendingPolicy[]> = new Map(); // accountId -> policies
  budgets: Map<string, Budget[]> = new Map(); // accountId -> budgets
  multisig: Map<string, MultiSigProposal[]> = new Map(); // accountId -> proposals
  auditLogs: Map<string, AuditLog[]> = new Map(); // accountId -> audit logs
  settings: Map<string, AccountSettings> = new Map(); // accountId -> settings

  constructor() {
    this.seedDefaults();
  }

  private seedDefaults() {
    const defaultAccounts: TreasuryAccount[] = [
      {
        id: "acc-main-treasury",
        name: "Main Operations Treasury",
        description: "Primary operational fund for protocol development and grants.",
        address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        type: "Business",
        status: "Active",
        contextRuleId: 1,
        createdAt: new Date("2026-01-15T08:00:00Z").toISOString(),
        updatedAt: new Date("2026-01-15T08:00:00Z").toISOString(),
      },
      {
        id: "acc-dao-grants",
        name: "Community DAO Treasury",
        description: "Community governed fund for ecosystem development grants.",
        address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF",
        type: "DAO",
        status: "Active",
        contextRuleId: 2,
        createdAt: new Date("2026-02-01T10:30:00Z").toISOString(),
        updatedAt: new Date("2026-02-01T10:30:00Z").toISOString(),
      },
      {
        id: "acc-yield-project",
        name: "Yield Maximizer Pool",
        description: "Automated liquidity and yield harvesting project account.",
        address: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWHF",
        type: "Project",
        status: "Active",
        contextRuleId: 3,
        createdAt: new Date("2026-03-10T14:15:00Z").toISOString(),
        updatedAt: new Date("2026-03-10T14:15:00Z").toISOString(),
      },
    ];

    for (const acc of defaultAccounts) {
      this.accounts.set(acc.id, acc);

      // Members
      this.members.set(acc.id, [
        {
          id: `mem-${acc.id}-1`,
          accountId: acc.id,
          email: "owner@spendguard.io",
          name: "Alice Owner",
          role: "Owner",
          addedAt: acc.createdAt,
        },
        {
          id: `mem-${acc.id}-2`,
          accountId: acc.id,
          email: "admin@spendguard.io",
          name: "Bob Admin",
          role: "Admin",
          addedAt: acc.createdAt,
        },
        {
          id: `mem-${acc.id}-3`,
          accountId: acc.id,
          email: "finance@spendguard.io",
          name: "Carol Finance",
          role: "Finance Manager",
          addedAt: acc.createdAt,
        },
        {
          id: `mem-${acc.id}-4`,
          accountId: acc.id,
          email: "approver@spendguard.io",
          name: "Dan Approver",
          role: "Approver",
          addedAt: acc.createdAt,
        },
        {
          id: `mem-${acc.id}-5`,
          accountId: acc.id,
          email: "viewer@spendguard.io",
          name: "Eve Viewer",
          role: "Viewer",
          addedAt: acc.createdAt,
        },
      ]);

      // Policies
      this.policies.set(acc.id, [
        {
          id: `pol-${acc.id}-1`,
          accountId: acc.id,
          name: "Daily Execution Cap",
          cap: 50_000_000_000n, // 5,000 XLM/USDC
          windowSeconds: 86400n,
          assetId: "USDC",
          status: "Active",
          createdAt: acc.createdAt,
        },
        {
          id: `pol-${acc.id}-2`,
          accountId: acc.id,
          name: "Emergency Stop Window",
          cap: 200_000_000_000n, // 20,000 XLM/USDC
          windowSeconds: 604800n,
          assetId: "USDC",
          status: "Active",
          createdAt: acc.createdAt,
        },
      ]);

      // Budgets
      this.budgets.set(acc.id, [
        {
          id: `bud-${acc.id}-1`,
          accountId: acc.id,
          name: "Infrastructure & Cloud",
          category: "Operations",
          allocatedAmount: 15_000_000_000n,
          spentAmount: 8_200_000_000n,
          period: "Monthly",
          status: "Active",
          createdAt: acc.createdAt,
        },
        {
          id: `bud-${acc.id}-2`,
          accountId: acc.id,
          name: "Security Audits",
          category: "Security",
          allocatedAmount: 50_000_000_000n,
          spentAmount: 12_500_000_000n,
          period: "Quarterly",
          status: "Active",
          createdAt: acc.createdAt,
        },
      ]);

      // MultiSig Proposals
      this.multisig.set(acc.id, [
        {
          id: `prop-${acc.id}-1`,
          accountId: acc.id,
          title: "Quarterly Auditor Retainer Payment",
          description: "Payment to CertiK for smart contract verification",
          amount: 25_000_000_000n,
          recipient: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          requiredApprovals: 2,
          status: "Pending",
          createdBy: "finance@spendguard.io",
          createdAt: new Date().toISOString(),
          approvals: [
            {
              id: `app-${acc.id}-1`,
              proposalId: `prop-${acc.id}-1`,
              approverEmail: "finance@spendguard.io",
              decision: "Approved",
              note: "Verified invoice #1094",
              timestamp: new Date().toISOString(),
            },
          ],
        },
      ]);

      // Audit Logs
      this.auditLogs.set(acc.id, [
        {
          id: `log-${acc.id}-1`,
          accountId: acc.id,
          action: "ACCOUNT_CREATED",
          actorEmail: "owner@spendguard.io",
          details: `Treasury account "${acc.name}" initialized with Stellar address ${acc.address}`,
          ipAddress: "127.0.0.1",
          createdAt: acc.createdAt,
        },
      ]);

      // Settings
      this.settings.set(acc.id, {
        accountId: acc.id,
        webhookUrl: "https://api.spendguard.io/webhooks/alerts",
        nearMissThresholdPct: 90,
        multisigThreshold: 2,
        notificationEmail: "alerts@spendguard.io",
        autoLockOnBreach: true,
        updatedAt: acc.createdAt,
      });
    }
  }

  /** Restore the store to its freshly-seeded state, discarding all mutations. */
  reset() {
    this.accounts.clear();
    this.members.clear();
    this.policies.clear();
    this.budgets.clear();
    this.multisig.clear();
    this.auditLogs.clear();
    this.settings.clear();
    this.seedDefaults();
  }
}

const memoryStore = new MemoryStore();

/**
 * Restore the in-memory demo store to its seeded state.
 *
 * The store is a module singleton, so without this the suites that create
 * accounts would leak that state into later suites and assert against each
 * other's leftovers. Intended for tests; production code never calls it.
 */
export function resetMemoryStore(): void {
  memoryStore.reset();
}

// ── Database Helper ───────────────────────────────────────────────────

function getDb(): postgres.Sql | null {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  try {
    return postgres(databaseUrl, { max: 2, idle_timeout: 10 });
  } catch {
    return null;
  }
}

// ── Account Service ───────────────────────────────────────────────────

type AccountFilters = { status?: AccountStatus; type?: AccountType; search?: string };

function filterAccounts(list: TreasuryAccount[], filters?: AccountFilters): TreasuryAccount[] {
  let result = list;
  if (filters?.status) {
    result = result.filter((a) => a.status === filters.status);
  }
  if (filters?.type) {
    result = result.filter((a) => a.type === filters.type);
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.address.toLowerCase().includes(q)
    );
  }
  return result.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export class AccountService {
  // ── Account CRUD ────────────────────────────────────────────────────

  static async listAccountsForMember(
    email: string,
    filters?: { status?: AccountStatus; type?: AccountType; search?: string }
  ): Promise<TreasuryAccount[]> {
    const db = getDb();
    if (db) {
      try {
        const rows = await db`
          SELECT ta.id, ta.name, ta.description, ta.address, ta.type, ta.status,
                 ta.context_rule_id, ta.created_at, ta.updated_at
          FROM treasury_accounts ta
          JOIN account_members am ON am.account_id = ta.id
          WHERE lower(am.email) = lower(${email})
          ORDER BY ta.created_at DESC
        `;
        await db.end({ timeout: 2 });
        return filterAccounts(
          rows.map((r) => ({
            id: r.id as string,
            name: r.name as string,
            description: (r.description as string) || "",
            address: r.address as string,
            type: r.type as AccountType,
            status: r.status as AccountStatus,
            contextRuleId: r.context_rule_id as number,
            createdAt: (r.created_at as Date).toISOString(),
            updatedAt: (r.updated_at as Date).toISOString(),
          })),
          filters
        );
      } catch (err) {
        console.warn("DB membership-scoped account query failed, using memory store:", err);
      }
    }

    // Membership is the boundary: a treasury you do not belong to is not
    // filtered out of the response, it is absent from it.
    const memberships = new Set<string>();
    for (const [accountId, members] of memoryStore.members.entries()) {
      if (members.some((m) => m.email.toLowerCase() === email.toLowerCase())) {
        memberships.add(accountId);
      }
    }
    return filterAccounts(
      Array.from(memoryStore.accounts.values()).filter((a) => memberships.has(a.id)),
      filters
    );
  }

  static async listAccounts(filters?: {
    status?: AccountStatus;
    type?: AccountType;
    search?: string;
  }): Promise<TreasuryAccount[]> {
    const db = getDb();
    if (db) {
      try {
        const accounts = await db`
          SELECT id, name, description, address, type, status, context_rule_id, created_at, updated_at
          FROM treasury_accounts
          ORDER BY created_at DESC
        `;
        await db.end({ timeout: 2 });
        return filterAccounts(
          accounts.map((r) => ({
            id: r.id as string,
            name: r.name as string,
            description: (r.description as string) || "",
            address: r.address as string,
            type: r.type as AccountType,
            status: r.status as AccountStatus,
            contextRuleId: r.context_rule_id as number,
            createdAt: (r.created_at as Date).toISOString(),
            updatedAt: (r.updated_at as Date).toISOString(),
          })),
          filters
        );
      } catch (err) {
        console.warn("DB query failed, using memory store fallback:", err);
      }
    }

    return filterAccounts(Array.from(memoryStore.accounts.values()), filters);
  }

  static async getAccountById(id: string): Promise<TreasuryAccount | null> {
    const list = await this.listAccounts();
    return list.find((a) => a.id === id || a.address === id) ?? null;
  }

  static async createAccount(data: {
    name: string;
    description?: string;
    address: string;
    type: AccountType;
    contextRuleId?: number;
    ownerEmail: string;
    ownerName: string;
    initialCap?: bigint;
  }): Promise<TreasuryAccount> {
    // Validations
    if (!data.name || data.name.trim().length === 0) {
      throw new Error("Account name is required");
    }
    if (!isValidStellarAddress(data.address)) {
      throw new Error("Invalid Stellar wallet address (must start with G and be 56 characters)");
    }
    if (!data.ownerEmail || !data.ownerEmail.includes("@")) {
      throw new Error("Valid owner email is required");
    }

    const id = `acc-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const now = new Date().toISOString();
    const newAccount: TreasuryAccount = {
      id,
      name: data.name.trim(),
      description: data.description?.trim() || "",
      address: data.address.trim(),
      type: data.type || "Business",
      status: "Active",
      contextRuleId: data.contextRuleId || 1,
      createdAt: now,
      updatedAt: now,
    };

    // Store in memory
    memoryStore.accounts.set(id, newAccount);

    // Initial Owner Member
    const ownerMember: AccountMember = {
      id: `mem-${id}-owner`,
      accountId: id,
      email: data.ownerEmail.trim(),
      name: data.ownerName?.trim() || "Account Owner",
      role: "Owner",
      addedAt: now,
    };
    memoryStore.members.set(id, [ownerMember]);

    // Initial Spending Policy
    const defaultPolicy: SpendingPolicy = {
      id: `pol-${id}-1`,
      accountId: id,
      name: "Default Spending Policy",
      cap: data.initialCap || 100_000_000_000n, // 10,000 XLM/USDC
      windowSeconds: 86400n,
      assetId: "USDC",
      status: "Active",
      createdAt: now,
    };
    memoryStore.policies.set(id, [defaultPolicy]);

    // Initial Budget
    const defaultBudget: Budget = {
      id: `bud-${id}-1`,
      accountId: id,
      name: "General Treasury Budget",
      category: "Operations",
      allocatedAmount: data.initialCap || 100_000_000_000n,
      spentAmount: 0n,
      period: "Monthly",
      status: "Active",
      createdAt: now,
    };
    memoryStore.budgets.set(id, [defaultBudget]);

    // Initial Settings
    memoryStore.settings.set(id, {
      accountId: id,
      webhookUrl: null,
      nearMissThresholdPct: 90,
      multisigThreshold: 2,
      notificationEmail: data.ownerEmail.trim(),
      autoLockOnBreach: true,
      updatedAt: now,
    });

    // Initial Audit Log
    const auditLog: AuditLog = {
      id: `log-${id}-init`,
      accountId: id,
      action: "ACCOUNT_CREATED",
      actorEmail: data.ownerEmail.trim(),
      details: `Treasury account "${newAccount.name}" (${newAccount.type}) created with address ${newAccount.address}`,
      ipAddress: "127.0.0.1",
      createdAt: now,
    };
    memoryStore.auditLogs.set(id, [auditLog]);
    memoryStore.multisig.set(id, []);

    // Try DB insert if available
    const db = getDb();
    if (db) {
      try {
        await db`
          INSERT INTO treasury_accounts (id, name, description, address, type, status, context_rule_id, created_at, updated_at)
          VALUES (${newAccount.id}, ${newAccount.name}, ${newAccount.description}, ${newAccount.address}, ${newAccount.type}, ${newAccount.status}, ${newAccount.contextRuleId}, ${now}, ${now})
        `;
        await db.end({ timeout: 2 });
      } catch (err) {
        console.warn("DB insert failed, stored in memory:", err);
      }
    }

    return newAccount;
  }

  static async updateAccount(
    id: string,
    updates: Partial<Pick<TreasuryAccount, "name" | "description" | "type" | "status" | "contextRuleId">>,
    actorRole: AccountRole,
    actorEmail: string
  ): Promise<TreasuryAccount> {
    if (!hasPermission(actorRole, "account:edit")) {
      throw new Error(`Role "${actorRole}" does not have permission to edit accounts`);
    }

    const account = await this.getAccountById(id);
    if (!account) throw new Error("Account not found");

    if (updates.name !== undefined && updates.name.trim().length === 0) {
      throw new Error("Account name cannot be empty");
    }

    const now = new Date().toISOString();
    const updated: TreasuryAccount = {
      ...account,
      ...updates,
      updatedAt: now,
    };

    memoryStore.accounts.set(account.id, updated);

    // Audit log
    await this.addAuditLog(
      account.id,
      "ACCOUNT_UPDATED",
      actorEmail,
      `Account updated: ${JSON.stringify(updates)}`
    );

    return updated;
  }

  static async archiveOrDeleteAccount(
    id: string,
    action: "archive" | "delete",
    actorRole: AccountRole,
    actorEmail: string
  ): Promise<boolean> {
    const requiredPermission = action === "archive" ? "account:archive" : "account:delete";
    if (!hasPermission(actorRole, requiredPermission)) {
      throw new Error(`Role "${actorRole}" does not have permission to ${action} account`);
    }

    const account = await this.getAccountById(id);
    if (!account) throw new Error("Account not found");

    if (action === "archive") {
      account.status = "Archived";
      account.updatedAt = new Date().toISOString();
      memoryStore.accounts.set(account.id, account);
      await this.addAuditLog(account.id, "ACCOUNT_ARCHIVED", actorEmail, `Account archived`);
    } else {
      memoryStore.accounts.delete(account.id);
    }
    return true;
  }

  // ── Members Management ──────────────────────────────────────────────

  static async getMembers(accountId: string): Promise<AccountMember[]> {
    const account = await this.getAccountById(accountId);
    if (!account) return [];
    return memoryStore.members.get(account.id) || [];
  }

  static async addMember(
    accountId: string,
    data: { email: string; name: string; role: AccountRole },
    actorRole: AccountRole,
    actorEmail: string
  ): Promise<AccountMember> {
    if (!hasPermission(actorRole, "members:manage")) {
      throw new Error(`Role "${actorRole}" does not have permission to manage members`);
    }

    const account = await this.getAccountById(accountId);
    if (!account) throw new Error("Account not found");

    const existingMembers = memoryStore.members.get(account.id) || [];
    if (existingMembers.some((m) => m.email.toLowerCase() === data.email.toLowerCase())) {
      throw new Error(`Member with email ${data.email} already exists in this account`);
    }

    const newMember: AccountMember = {
      id: `mem-${account.id}-${Date.now()}`,
      accountId: account.id,
      email: data.email.trim(),
      name: data.name.trim(),
      role: data.role,
      addedAt: new Date().toISOString(),
    };

    existingMembers.push(newMember);
    memoryStore.members.set(account.id, existingMembers);

    await this.addAuditLog(
      account.id,
      "MEMBER_ADDED",
      actorEmail,
      `Added member ${newMember.email} with role ${newMember.role}`
    );

    return newMember;
  }

  static async updateMemberRole(
    accountId: string,
    memberId: string,
    newRole: AccountRole,
    actorRole: AccountRole,
    actorEmail: string
  ): Promise<AccountMember> {
    if (!hasPermission(actorRole, "members:manage")) {
      throw new Error(`Role "${actorRole}" does not have permission to manage members`);
    }

    const account = await this.getAccountById(accountId);
    if (!account) throw new Error("Account not found");

    const members = memoryStore.members.get(account.id) || [];
    const member = members.find((m) => m.id === memberId || m.email === memberId);
    if (!member) throw new Error("Member not found");

    member.role = newRole;
    memoryStore.members.set(account.id, members);

    await this.addAuditLog(
      account.id,
      "MEMBER_ROLE_UPDATED",
      actorEmail,
      `Updated member ${member.email} role to ${newRole}`
    );

    return member;
  }

  static async removeMember(
    accountId: string,
    memberId: string,
    actorRole: AccountRole,
    actorEmail: string
  ): Promise<boolean> {
    if (!hasPermission(actorRole, "members:manage")) {
      throw new Error(`Role "${actorRole}" does not have permission to manage members`);
    }

    const account = await this.getAccountById(accountId);
    if (!account) throw new Error("Account not found");

    let members = memoryStore.members.get(account.id) || [];
    const target = members.find((m) => m.id === memberId || m.email === memberId);
    if (!target) throw new Error("Member not found");

    if (target.role === "Owner") {
      const ownerCount = members.filter((m) => m.role === "Owner").length;
      if (ownerCount <= 1) {
        throw new Error("Cannot remove the only Owner of an account");
      }
    }

    members = members.filter((m) => m.id !== target.id);
    memoryStore.members.set(account.id, members);

    await this.addAuditLog(
      account.id,
      "MEMBER_REMOVED",
      actorEmail,
      `Removed member ${target.email}`
    );

    return true;
  }

  // ── Spending Policies ───────────────────────────────────────────────

  static async getPolicies(accountId: string): Promise<SpendingPolicy[]> {
    const account = await this.getAccountById(accountId);
    if (!account) return [];
    return memoryStore.policies.get(account.id) || [];
  }

  static async createPolicy(
    accountId: string,
    data: { name: string; cap: bigint; windowSeconds: bigint; assetId?: string },
    actorRole: AccountRole,
    actorEmail: string
  ): Promise<SpendingPolicy> {
    if (!hasPermission(actorRole, "policies:manage")) {
      throw new Error(`Role "${actorRole}" does not have permission to manage policies`);
    }

    const account = await this.getAccountById(accountId);
    if (!account) throw new Error("Account not found");

    const newPolicy: SpendingPolicy = {
      id: `pol-${account.id}-${Date.now()}`,
      accountId: account.id,
      name: data.name.trim(),
      cap: data.cap,
      windowSeconds: data.windowSeconds,
      assetId: data.assetId || "USDC",
      status: "Active",
      createdAt: new Date().toISOString(),
    };

    const policies = memoryStore.policies.get(account.id) || [];
    policies.push(newPolicy);
    memoryStore.policies.set(account.id, policies);

    await this.addAuditLog(
      account.id,
      "POLICY_CREATED",
      actorEmail,
      `Created spending policy "${newPolicy.name}" with cap ${newPolicy.cap.toString()}`
    );

    return newPolicy;
  }

  // ── Budgets ─────────────────────────────────────────────────────────

  static async getBudgets(accountId: string): Promise<Budget[]> {
    const account = await this.getAccountById(accountId);
    if (!account) return [];
    return memoryStore.budgets.get(account.id) || [];
  }

  static async createBudget(
    accountId: string,
    data: {
      name: string;
      category: string;
      allocatedAmount: bigint;
      period: "Monthly" | "Quarterly" | "Annual";
    },
    actorRole: AccountRole,
    actorEmail: string
  ): Promise<Budget> {
    if (!hasPermission(actorRole, "budgets:manage")) {
      throw new Error(`Role "${actorRole}" does not have permission to manage budgets`);
    }

    const account = await this.getAccountById(accountId);
    if (!account) throw new Error("Account not found");

    const newBudget: Budget = {
      id: `bud-${account.id}-${Date.now()}`,
      accountId: account.id,
      name: data.name.trim(),
      category: data.category.trim(),
      allocatedAmount: data.allocatedAmount,
      spentAmount: 0n,
      period: data.period,
      status: "Active",
      createdAt: new Date().toISOString(),
    };

    const budgets = memoryStore.budgets.get(account.id) || [];
    budgets.push(newBudget);
    memoryStore.budgets.set(account.id, budgets);

    await this.addAuditLog(
      account.id,
      "BUDGET_CREATED",
      actorEmail,
      `Created budget "${newBudget.name}" (${newBudget.category}) for ${newBudget.allocatedAmount.toString()}`
    );

    return newBudget;
  }

  // ── Multi-Signature Approvals ───────────────────────────────────────

  static async getMultiSigProposals(accountId: string): Promise<MultiSigProposal[]> {
    const account = await this.getAccountById(accountId);
    if (!account) return [];
    return memoryStore.multisig.get(account.id) || [];
  }

  static async createMultiSigProposal(
    accountId: string,
    data: {
      title: string;
      description?: string;
      amount: bigint;
      recipient: string;
      requiredApprovals?: number;
    },
    actorRole: AccountRole,
    actorEmail: string
  ): Promise<MultiSigProposal> {
    if (!hasPermission(actorRole, "multisig:create")) {
      throw new Error(`Role "${actorRole}" does not have permission to create multi-sig proposals`);
    }

    const account = await this.getAccountById(accountId);
    if (!account) throw new Error("Account not found");

    const proposal: MultiSigProposal = {
      id: `prop-${account.id}-${Date.now()}`,
      accountId: account.id,
      title: data.title.trim(),
      description: data.description?.trim() || "",
      amount: data.amount,
      recipient: data.recipient.trim(),
      requiredApprovals: data.requiredApprovals || 2,
      status: "Pending",
      createdBy: actorEmail,
      createdAt: new Date().toISOString(),
      approvals: [],
    };

    const list = memoryStore.multisig.get(account.id) || [];
    list.push(proposal);
    memoryStore.multisig.set(account.id, list);

    await this.addAuditLog(
      account.id,
      "MULTISIG_PROPOSAL_CREATED",
      actorEmail,
      `Created proposal "${proposal.title}" for ${proposal.amount.toString()}`
    );

    return proposal;
  }

  static async submitApproval(
    proposalId: string,
    data: { approverEmail: string; decision: "Approved" | "Rejected"; note?: string },
    actorRole: AccountRole
  ): Promise<MultiSigProposal> {
    if (!hasPermission(actorRole, "multisig:approve")) {
      throw new Error(`Role "${actorRole}" does not have permission to approve multi-sig proposals`);
    }

    // Find proposal
    let foundProposal: MultiSigProposal | null = null;
    let accountId = "";

    for (const [accId, proposals] of memoryStore.multisig.entries()) {
      const p = proposals.find((prop) => prop.id === proposalId);
      if (p) {
        foundProposal = p;
        accountId = accId;
        break;
      }
    }

    if (!foundProposal) throw new Error("Multi-sig proposal not found");

    if (foundProposal.status !== "Pending") {
      throw new Error(`Proposal is already ${foundProposal.status}`);
    }

    // Check if already approved/rejected by this email
    if (foundProposal.approvals.some((a) => a.approverEmail.toLowerCase() === data.approverEmail.toLowerCase())) {
      throw new Error(`Approver ${data.approverEmail} has already submitted a decision`);
    }

    foundProposal.approvals.push({
      id: `app-${Date.now()}`,
      proposalId: foundProposal.id,
      approverEmail: data.approverEmail,
      decision: data.decision,
      note: data.note || null,
      timestamp: new Date().toISOString(),
    });

    const approvedCount = foundProposal.approvals.filter((a) => a.decision === "Approved").length;
    const rejectedCount = foundProposal.approvals.filter((a) => a.decision === "Rejected").length;

    if (approvedCount >= foundProposal.requiredApprovals) {
      foundProposal.status = "Approved";
    } else if (rejectedCount > 0) {
      foundProposal.status = "Rejected";
    }

    await this.addAuditLog(
      accountId,
      "MULTISIG_DECISION_SUBMITTED",
      data.approverEmail,
      `Submitted ${data.decision} for proposal "${foundProposal.title}"`
    );

    return foundProposal;
  }

  // ── Audit Logs ──────────────────────────────────────────────────────

  static async getAuditLogs(accountId: string): Promise<AuditLog[]> {
    const account = await this.getAccountById(accountId);
    if (!account) return [];
    const logs = memoryStore.auditLogs.get(account.id) || [];
    return logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  static async addAuditLog(
    accountId: string,
    action: string,
    actorEmail: string,
    details: string,
    ipAddress?: string
  ): Promise<AuditLog> {
    const log: AuditLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      accountId,
      action,
      actorEmail,
      details,
      ipAddress: ipAddress || "127.0.0.1",
      createdAt: new Date().toISOString(),
    };

    const logs = memoryStore.auditLogs.get(accountId) || [];
    logs.push(log);
    memoryStore.auditLogs.set(accountId, logs);
    return log;
  }

  // ── Settings ────────────────────────────────────────────────────────

  static async getSettings(accountId: string): Promise<AccountSettings> {
    const account = await this.getAccountById(accountId);
    if (!account) throw new Error("Account not found");

    const settings = memoryStore.settings.get(account.id);
    if (settings) return settings;

    const defaultSettings: AccountSettings = {
      accountId: account.id,
      webhookUrl: null,
      nearMissThresholdPct: 90,
      multisigThreshold: 2,
      notificationEmail: "admin@spendguard.io",
      autoLockOnBreach: true,
      updatedAt: new Date().toISOString(),
    };
    memoryStore.settings.set(account.id, defaultSettings);
    return defaultSettings;
  }

  static async updateSettings(
    accountId: string,
    updates: Partial<AccountSettings>,
    actorRole: AccountRole,
    actorEmail: string
  ): Promise<AccountSettings> {
    if (!hasPermission(actorRole, "account:edit")) {
      throw new Error(`Role "${actorRole}" does not have permission to update settings`);
    }

    const current = await this.getSettings(accountId);
    const updated: AccountSettings = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    memoryStore.settings.set(accountId, updated);

    await this.addAuditLog(
      accountId,
      "SETTINGS_UPDATED",
      actorEmail,
      `Updated account settings`
    );

    return updated;
  }
}
