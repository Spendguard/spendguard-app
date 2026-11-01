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

    const settings = await AccountService.getSettings(id);
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
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

    const updated = await AccountService.updateSettings(
      id,
      {
        webhookUrl: body.webhookUrl ?? null,
        nearMissThresholdPct: body.nearMissThresholdPct ? Number(body.nearMissThresholdPct) : undefined,
        multisigThreshold: body.multisigThreshold ? Number(body.multisigThreshold) : undefined,
        notificationEmail: body.notificationEmail ?? null,
        autoLockOnBreach: body.autoLockOnBreach !== undefined ? Boolean(body.autoLockOnBreach) : undefined,
      },
      auth.actor.role,
      auth.actor.email
    );

    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update settings" },
      { status: 400 }
    );
  }
}
