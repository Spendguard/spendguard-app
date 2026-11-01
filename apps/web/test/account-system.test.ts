import { describe, it, expect, beforeEach } from "vitest";
import { AccountService, resetMemoryStore } from "../lib/services/account-service";
import {
  hasPermission,
  isValidStellarAddress,
  AccountRole,
  Permission,
} from "@spendguard/sdk";

describe("Multi-Account Management System", () => {
  const VALID_STELLAR_ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const ANOTHER_VALID_ADDR = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";
  const THIRD_VALID_ADDR   = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWHF";

  beforeEach(() => {
    resetMemoryStore();
  });

  it("keeps the address fixtures meaningful for the validator", () => {
    // If these constants ever stop passing the real validator, every test that
    // relies on them to reach the permission checks would be asserting nothing.
    for (const address of [VALID_STELLAR_ADDR, ANOTHER_VALID_ADDR, THIRD_VALID_ADDR]) {
      expect(isValidStellarAddress(address)).toBe(true);
    }
    expect(isValidStellarAddress("INVALID_ADDRESS_123")).toBe(false);
  });

  describe("Account Creation & Input Validation", () => {
    it("creates a valid treasury account with default owner, policy, budget, and settings", async () => {
      const acc = await AccountService.createAccount({
        name: "Acme Ecosystem Vault",
        description: "Primary fund for ecosystem expansion",
        address: VALID_STELLAR_ADDR,
        type: "DAO",
        ownerEmail: "owner@acme.io",
        ownerName: "Alice Acme",
        initialCap: 50_000_000_000n,
      });

      expect(acc).toBeDefined();
      expect(acc.id).toContain("acc-");
      expect(acc.name).toBe("Acme Ecosystem Vault");
      expect(acc.address).toBe(VALID_STELLAR_ADDR);
      expect(acc.type).toBe("DAO");
      expect(acc.status).toBe("Active");

      // Verify owner member creation
      const members = await AccountService.getMembers(acc.id);
      expect(members.length).toBeGreaterThanOrEqual(1);
      expect(members[0].email).toBe("owner@acme.io");
      expect(members[0].role).toBe("Owner");

      // Verify initial policy
      const policies = await AccountService.getPolicies(acc.id);
      expect(policies.length).toBeGreaterThanOrEqual(1);

      // Verify initial budget
      const budgets = await AccountService.getBudgets(acc.id);
      expect(budgets.length).toBeGreaterThanOrEqual(1);

      // Verify initial audit log
      const logs = await AccountService.getAuditLogs(acc.id);
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].action).toBe("ACCOUNT_CREATED");
    });

    it("rejects account creation with empty name", async () => {
      await expect(
        AccountService.createAccount({
          name: "  ",
          address: VALID_STELLAR_ADDR,
          type: "Business",
          ownerEmail: "owner@spendguard.io",
          ownerName: "Alice",
        })
      ).rejects.toThrow("Account name is required");
    });

    it("rejects account creation with invalid Stellar wallet address", async () => {
      await expect(
        AccountService.createAccount({
          name: "Test Vault",
          address: "INVALID_ADDRESS_123",
          type: "Business",
          ownerEmail: "owner@spendguard.io",
          ownerName: "Alice",
        })
      ).rejects.toThrow(/Invalid Stellar wallet address/);
    });

    it("rejects account creation with invalid owner email", async () => {
      await expect(
        AccountService.createAccount({
          name: "Test Vault",
          address: VALID_STELLAR_ADDR,
          type: "Business",
          ownerEmail: "invalid-email",
          ownerName: "Alice",
        })
      ).rejects.toThrow("Valid owner email is required");
    });
  });

  describe("Account Updates, Archiving, and Deletion", () => {
    it("updates account metadata when requested by Owner or Admin", async () => {
      const acc = await AccountService.createAccount({
        name: "Original Name",
        address: ANOTHER_VALID_ADDR,
        type: "Project",
        ownerEmail: "admin@spendguard.io",
        ownerName: "Bob Admin",
      });

      const updated = await AccountService.updateAccount(
        acc.id,
        { name: "Updated Name", type: "NGO" },
        "Admin",
        "admin@spendguard.io"
      );

      expect(updated.name).toBe("Updated Name");
      expect(updated.type).toBe("NGO");
    });

    it("prevents Viewer from updating account metadata", async () => {
      const acc = await AccountService.getAccountById("acc-main-treasury");
      expect(acc).not.toBeNull();

      await expect(
        AccountService.updateAccount(
          acc!.id,
          { name: "Hacked Name" },
          "Viewer",
          "viewer@spendguard.io"
        )
      ).rejects.toThrow(/does not have permission/);

      const unchanged = await AccountService.getAccountById(acc!.id);
      expect(unchanged?.name).toBe("Main Operations Treasury");
    });

    it("archives an account when requested by Owner", async () => {
      const acc = await AccountService.createAccount({
        name: "Vault to Archive",
        address: THIRD_VALID_ADDR,
        type: "Personal",
        ownerEmail: "owner@spendguard.io",
        ownerName: "Alice Owner",
      });

      const result = await AccountService.archiveOrDeleteAccount(
        acc.id,
        "archive",
        "Owner",
        "owner@spendguard.io"
      );

      expect(result).toBe(true);
      const archivedAcc = await AccountService.getAccountById(acc.id);
      expect(archivedAcc?.status).toBe("Archived");
    });
  });

  describe("Role-Based Permissions Enforcement", () => {
    const roles: AccountRole[] = ["Owner", "Admin", "Finance Manager", "Approver", "Viewer"];

    /**
     * Every AccountService mutation that carries an RBAC guard. The per-role
     * checks below document the intent; this table is the regression net that
     * fails if a guard is dropped or pointed at the wrong permission string —
     * which the SDK's own unit tests cannot catch, since they never go through
     * the service.
     */
    const guardedOperations: Array<{
      permission: Permission;
      invoke: (
        ids: { account: string; proposal: string },
        role: AccountRole,
        email: string
      ) => Promise<unknown>;
    }> = [
      {
        permission: "account:edit",
        invoke: (ids, role, email) =>
          AccountService.updateAccount(ids.account, { description: "edited" }, role, email),
      },
      {
        permission: "account:archive",
        invoke: (ids, role, email) =>
          AccountService.archiveOrDeleteAccount(ids.account, "archive", role, email),
      },
      {
        permission: "account:delete",
        invoke: (ids, role, email) =>
          AccountService.archiveOrDeleteAccount(ids.account, "delete", role, email),
      },
      {
        permission: "members:manage",
        invoke: (ids, role, email) =>
          AccountService.addMember(
            ids.account,
            { email: `actor@spendguard.io`, name: "New Member", role: "Viewer" },
            role,
            email
          ),
      },
      {
        permission: "policies:manage",
        invoke: (ids, role, email) =>
          AccountService.createPolicy(
            ids.account,
            { name: "Matrix policy", cap: 1_000n, windowSeconds: 86_400n },
            role,
            email
          ),
      },
      {
        permission: "budgets:manage",
        invoke: (ids, role, email) =>
          AccountService.createBudget(
            ids.account,
            { name: "Matrix budget", category: "Marketing", allocatedAmount: 1_000n, period: "Monthly" },
            role,
            email
          ),
      },
      {
        permission: "multisig:create",
        invoke: (ids, role, email) =>
          AccountService.createMultiSigProposal(
            ids.account,
            { title: "Matrix payout", amount: 1_000n, recipient: VALID_STELLAR_ADDR },
            role,
            email
          ),
      },
      {
        permission: "multisig:approve",
        invoke: (ids, role) =>
          AccountService.submitApproval(
            ids.proposal,
            { approverEmail: "approver@spendguard.io", decision: "Approved" },
            role
          ),
      },
    ];

    /** A dedicated account + pending proposal per (role, permission) pair. */
    async function contextFor(role: AccountRole, permission: Permission) {
      const slug = `${role.replace(/ /g, "-").toLowerCase()}-${permission.replace(":", "-")}`;
      const account = await AccountService.createAccount({
        name: `Matrix ${slug}`,
        address: VALID_STELLAR_ADDR,
        type: "Business",
        ownerEmail: `owner-${slug}@spendguard.io`,
        ownerName: "Matrix Owner",
      });
      // requiredApprovals above the number any case will cast, so approving
      // never flips the proposal's status and perturbs a later assertion.
      const proposal = await AccountService.createMultiSigProposal(
        account.id,
        { title: `Proposal ${slug}`, amount: 5_000n, recipient: VALID_STELLAR_ADDR, requiredApprovals: 3 },
        "Owner",
        `owner-${slug}@spendguard.io`
      );
      return {
        ids: { account: account.id, proposal: proposal.id },
        actorEmail: `actor-${slug}@spendguard.io`,
      };
    }

    it.each(
      roles.flatMap((role) =>
        guardedOperations.map((op) => ({ role, permission: op.permission }))
      )
    )("$role may $permission", async ({ role, permission }) => {
      const operation = guardedOperations.find((op) => op.permission === permission)!;
      const { ids, actorEmail } = await contextFor(role, permission);
      const attempt = operation.invoke(ids, role, actorEmail);

      if (hasPermission(role, permission)) {
        await expect(attempt).resolves.toBeDefined();
      } else {
        await expect(attempt).rejects.toThrow(/does not have permission/);
      }
    });

    it("leaves no trace when a write is denied", async () => {
      const account = await AccountService.createAccount({
        name: "Untouchable Treasury",
        address: ANOTHER_VALID_ADDR,
        type: "Business",
        ownerEmail: "untouchable-owner@spendguard.io",
        ownerName: "Owner",
      });

      const membersBefore = await AccountService.getMembers(account.id);
      const budgetsBefore = await AccountService.getBudgets(account.id);

      await expect(
        AccountService.addMember(
          account.id,
          { email: "sneaky@spendguard.io", name: "Sneaky", role: "Admin" },
          "Viewer",
          "viewer@spendguard.io"
        )
      ).rejects.toThrow(/does not have permission/);

      await expect(
        AccountService.createBudget(
          account.id,
          { name: "Sneaky budget", category: "Marketing", allocatedAmount: 1_000n, period: "Monthly" },
          "Approver",
          "approver@spendguard.io"
        )
      ).rejects.toThrow(/does not have permission/);

      expect(await AccountService.getMembers(account.id)).toHaveLength(membersBefore.length);
      expect(await AccountService.getBudgets(account.id)).toHaveLength(budgetsBefore.length);
      expect(await AccountService.listAccounts({ search: "Sneaky" })).toHaveLength(0);
    });

    // Spot checks kept because they document the intended matrix in prose.
    it("enforces the documented hierarchy", () => {
      expect(hasPermission("Owner", "account:delete")).toBe(true);
      expect(hasPermission("Admin", "account:delete")).toBe(false);
      expect(hasPermission("Admin", "members:manage")).toBe(true);
      expect(hasPermission("Finance Manager", "members:manage")).toBe(false);
      expect(hasPermission("Approver", "budgets:manage")).toBe(false);
      expect(hasPermission("Viewer", "data:view")).toBe(true);

      // Viewer must be read-only against every guarded mutation, not just one.
      for (const op of guardedOperations) {
        expect(hasPermission("Viewer", op.permission)).toBe(false);
      }
    });

    it("prevents Finance Manager from adding new members", async () => {
      await expect(
        AccountService.addMember(
          "acc-main-treasury",
          { email: "new@spendguard.io", name: "New User", role: "Viewer" },
          "Finance Manager",
          "finance@spendguard.io"
        )
      ).rejects.toThrow(/does not have permission/);
    });
  });

  describe("Multi-Account Switching & Data Isolation", () => {
    it("ensures members, policies, budgets, and multi-sig proposals are isolated per account", async () => {
      const acc1 = await AccountService.createAccount({
        name: "Treasury Alpha",
        address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        type: "Business",
        ownerEmail: "alpha-owner@spendguard.io",
        ownerName: "Owner Alpha",
      });

      const acc2 = await AccountService.createAccount({
        name: "Treasury Beta",
        address: ANOTHER_VALID_ADDR,
        type: "NGO",
        ownerEmail: "beta-owner@spendguard.io",
        ownerName: "Owner Beta",
      });

      // Add unique budget to Alpha
      await AccountService.createBudget(
        acc1.id,
        { name: "Alpha Marketing Budget", category: "Marketing", allocatedAmount: 10_000_000_000n, period: "Monthly" },
        "Owner",
        "alpha-owner@spendguard.io"
      );

      // Add unique budget to Beta
      await AccountService.createBudget(
        acc2.id,
        { name: "Beta Legal Fund", category: "Security", allocatedAmount: 20_000_000_000n, period: "Quarterly" },
        "Owner",
        "beta-owner@spendguard.io"
      );

      const alphaBudgets = await AccountService.getBudgets(acc1.id);
      const betaBudgets = await AccountService.getBudgets(acc2.id);

      expect(alphaBudgets.some((b) => b.name === "Alpha Marketing Budget")).toBe(true);
      expect(alphaBudgets.some((b) => b.name === "Beta Legal Fund")).toBe(false);

      expect(betaBudgets.some((b) => b.name === "Beta Legal Fund")).toBe(true);
      expect(betaBudgets.some((b) => b.name === "Alpha Marketing Budget")).toBe(false);
    });
  });

  describe("Multi-Signature Approval Workflow", () => {
    it("creates proposal and reaches Approved status upon receiving required votes", async () => {
      const acc = await AccountService.createAccount({
        name: "Multi-Sig Vault",
        address: VALID_STELLAR_ADDR,
        type: "DAO",
        ownerEmail: "owner@spendguard.io",
        ownerName: "Alice Owner",
      });

      const proposal = await AccountService.createMultiSigProposal(
        acc.id,
        {
          title: "Grant Payment to Security Firm",
          amount: 50_000_000_000n,
          recipient: VALID_STELLAR_ADDR,
          requiredApprovals: 2,
        },
        "Finance Manager",
        "finance@spendguard.io"
      );

      expect(proposal.status).toBe("Pending");

      // First vote (Approval 1)
      const propAfter1 = await AccountService.submitApproval(
        proposal.id,
        { approverEmail: "approver1@spendguard.io", decision: "Approved", note: "Verified code" },
        "Approver"
      );
      expect(propAfter1.status).toBe("Pending");

      // Second vote (Approval 2) -> Meets threshold of 2
      const propAfter2 = await AccountService.submitApproval(
        proposal.id,
        { approverEmail: "approver2@spendguard.io", decision: "Approved", note: "Approved disbursement" },
        "Approver"
      );
      expect(propAfter2.status).toBe("Approved");
    });
  });
});
