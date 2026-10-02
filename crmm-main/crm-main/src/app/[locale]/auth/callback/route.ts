import {hasLocale} from "next-intl";
import {NextResponse, type NextRequest} from "next/server";
import {routing} from "@/i18n/routing";
import {createClient} from "@/lib/supabase/server";

export async function GET(request: NextRequest, {params}: {params: Promise<{locale: string}>}) {
  const {locale: requestedLocale} = await params;
  const locale = hasLocale(routing.locales, requestedLocale) ? requestedLocale : routing.defaultLocale;
  const code = request.nextUrl.searchParams.get("code");
  const inviteToken = request.nextUrl.searchParams.get("invite");

  if (code) {
    const supabase = await createClient();
    const {error} = await supabase.auth.exchangeCodeForSession(code);
    if (!error && inviteToken) {
      const {error: inviteError} = await supabase.rpc("accept_organization_invite", {invite_token: inviteToken});
      if (!inviteError) return NextResponse.redirect(new URL(`/${locale}/dashboard?notice=invite-accepted`, request.url));
      return NextResponse.redirect(new URL(`/${locale}/invite/${encodeURIComponent(inviteToken)}?error=invite`, request.url));
    }
    if (!error) return NextResponse.redirect(new URL(`/${locale}/onboarding`, request.url));
  }

  return NextResponse.redirect(new URL(`/${locale}?error=auth`, request.url));
}