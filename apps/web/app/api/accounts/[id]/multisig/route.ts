import { NextResponse } from "next/server";
import { AccountService } from "@/lib/services/account-service";
import { resolveActor } from "@/lib/auth/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const auth = await resolveActor(request, id);
    if ("failure" in auth) {
      return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
    }

    const proposals = await AccountService.getMultiSigProposals(id);
    const serialized = proposals.map((p) => ({
      ...p,
      amount: p.amount.toString(),
    }));
    return NextResponse.json(serialized);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const auth = await resolveActor(request, id);
    if ("failure" in auth) {
      return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
    }

    const body = await request.json();

    if (!body.title || !body.amount || !body.recipient) {
      return NextResponse.json(
        { error: "Missing required fields: title, amount, recipient" },
        { status: 400 }
      );
    }

    const proposal = await AccountService.createMultiSigProposal(
      id,
      {
        title: body.title,
        description: body.description,
        amount: BigInt(body.amount),
        recipient: body.recipient,
        requiredApprovals: body.requiredApprovals ? Number(body.requiredApprovals) : 2,
      },
      auth.actor.role,
      auth.actor.email
    );

    return NextResponse.json(
      {
        ...proposal,
        amount: proposal.amount.toString(),
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create multi-sig proposal" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const auth = await resolveActor(request, id);
  if ("failure" in auth) {
    return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
  }

  try {
    const body = await request.json();

    if (!body.proposalId || !body.decision) {
      return NextResponse.json(
        { error: "Missing required fields: proposalId, decision" },
        { status: 400 }
      );
    }

    // The approver is whoever is signed in. Trusting body.approverEmail let any
    // caller cast a vote in someone else's name and double-count their own.
    const updatedProposal = await AccountService.submitApproval(
      body.proposalId,
      {
        approverEmail: auth.actor.email,
        decision: body.decision,
        note: body.note,
      },
      auth.actor.role
    );

    return NextResponse.json({
      ...updatedProposal,
      amount: updatedProposal.amount.toString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to submit approval decision" },
      { status: 400 }
    );
  }
}
