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

    const policies = await AccountService.getPolicies(id);
    const serialized = policies.map((p) => ({
      ...p,
      cap: p.cap.toString(),
      windowSeconds: p.windowSeconds.toString(),
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

    if (!body.name || !body.cap) {
      return NextResponse.json(
        { error: "Missing required fields: name, cap" },
        { status: 400 }
      );
    }

    const policy = await AccountService.createPolicy(
      id,
      {
        name: body.name,
        cap: BigInt(body.cap),
        windowSeconds: body.windowSeconds ? BigInt(body.windowSeconds) : 86400n,
        assetId: body.assetId || "USDC",
      },
      auth.actor.role,
      auth.actor.email
    );

    return NextResponse.json(
      {
        ...policy,
        cap: policy.cap.toString(),
        windowSeconds: policy.windowSeconds.toString(),
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create policy" },
      { status: 400 }
    );
  }
}
