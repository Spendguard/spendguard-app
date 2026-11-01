import { NextResponse } from "next/server";
import { AccountService } from "@/lib/services/account-service";
import { resolveActor } from "@/lib/auth/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const auth = await resolveActor(request, id);
  if ("failure" in auth) {
    return NextResponse.json({ error: auth.failure.error }, { status: auth.failure.status });
  }

  try {
    const logs = await AccountService.getAuditLogs(id);
    return NextResponse.json(logs);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
