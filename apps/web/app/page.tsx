import type { Metadata } from "next";
import Link from "next/link";
import { PAID_TIERS, TEACHER_TIERS, TIERS, type TeacherTier } from "@majlis/shared";
import { landing, type LandingLang } from "@/components/landing/content";
import { SignedInRedirect } from "@/components/landing/SignedInRedirect";

type Props = { searchParams: Promise<{ lang?: string }> };

const langOf = (v?: string): LandingLang => (v === "en" ? "en" : "ar");

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const lang = langOf((await searchParams).lang);
  const c = landing[lang].meta;
  return {
    title: c.title,
    description: c.description,
    alternates: { canonical: lang === "en" ? "/?lang=en" : "/", languages: { ar: "/", en: "/?lang=en" } },
    openGraph: { title: c.title, description: c.description, type: "website", locale: lang === "ar" ? "ar_SA" : "en_US", images: ["/landing/dashboard.png"] },
    twitter: { card: "summary_large_image", title: c.title, description: c.description, images: ["/landing/dashboard.png"] },
  };
}

/** Platform landing page for logged-out visitors. Server-rendered so search engines can index it. */
export default async function Landing({ searchParams }: Props) {
  const lang = langOf((await searchParams).lang);
  const c = landing[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";
  const other = lang === "ar" ? "/?lang=en" : "/";

  return (
    <div dir={dir} lang={lang} className="min-h-full bg-bg text-fg">
      <SignedInRedirect />

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/85 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link href={lang === "ar" ? "/" : "/?lang=en"} className="text-2xl font-bold text-brand">
            {lang === "ar" ? "مجلس" : "Majlis"}
          </Link>
          <div className="hidden flex-1 items-center gap-6 text-sm text-muted md:flex">
            <a href="#features" className="hover:text-fg">{c.nav.features}</a>
            <a href="#pricing" className="hover:text-fg">{c.nav.pricing}</a>
            <a href="#faq" className="hover:text-fg">{c.nav.faq}</a>
          </div>
          <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
            <Link href={other} className="rounded-md px-2 py-1 text-xs text-muted hover:text-fg">{c.nav.lang}</Link>
            <Link href="/login" className="hidden rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-hover sm:block">{c.nav.login}</Link>
            <Link href="/register" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">{c.nav.start}</Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(15,138,95,0.25),transparent)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div className="space-y-6">
            <span className="inline-block rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
              {c.hero.badge}
            </span>
            <h1 className="text-4xl font-bold leading-tight md:text-5xl">{c.hero.title}</h1>
            <p className="text-lg text-muted">{c.hero.subtitle}</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/register" className="rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white shadow-lg shadow-brand/20 hover:bg-brand-hover">
                {c.hero.primary}
              </Link>
              <a href="#tour" className="rounded-xl border border-line px-6 py-3 text-base font-medium hover:bg-surface-hover">
                {c.hero.secondary}
              </a>
            </div>
            <p className="text-sm text-muted">✓ {c.hero.note}</p>
          </div>
          <div className="relative">
            <div className="overflow-hidden rounded-2xl border border-line shadow-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landing/course.png" alt="" className="w-full" width={1280} height={860} />
            </div>
            <div className="absolute -bottom-6 hidden w-36 overflow-hidden rounded-2xl border-4 border-bg shadow-2xl sm:block ltr:-left-6 rtl:-right-6 md:w-44">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landing/home-mobile.png" alt="" className="w-full" width={390} height={844} />
            </div>
          </div>
        </div>
      </section>

      {/* Who */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="mb-8 text-center text-3xl font-bold">{c.who.title}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {c.who.items.map(([icon, title, hint]) => (
            <div key={title} className="rounded-2xl border border-line bg-sidebar p-5 text-center">
              <div className="text-4xl">{icon}</div>
              <div className="mt-2 font-bold">{title}</div>
              <div className="text-sm text-muted">{hint}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="mb-8 text-center text-3xl font-bold">{c.how.title}</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {c.how.steps.map(([title, text], i) => (
            <li key={title} className="relative rounded-2xl border border-line bg-sidebar p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-lg font-bold text-white">{i + 1}</span>
              <h3 className="mt-4 text-lg font-bold">{title}</h3>
              <p className="mt-1 text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 bg-sidebar/60 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-10 text-center text-3xl font-bold">{c.features.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {c.features.items.map(([icon, title, text]) => (
              <div key={title} className="rounded-2xl border border-line bg-bg p-5">
                <div className="text-3xl">{icon}</div>
                <h3 className="mt-3 font-bold">{title}</h3>
                <p className="mt-1 text-sm text-muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Screenshots */}
      <section id="tour" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <h2 className="mb-10 text-center text-3xl font-bold">{c.shots.title}</h2>
        <div className="grid items-start gap-6 md:grid-cols-[2fr_2fr_1fr]">
          {c.shots.items.map(([caption, src]) => (
            <figure key={src} className="space-y-3">
              <div className="overflow-hidden rounded-2xl border border-line shadow-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={caption} className="w-full" loading="lazy" />
              </div>
              <figcaption className="text-center text-sm text-muted">{caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 bg-sidebar/60 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold">{c.pricing.title}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-muted">{c.pricing.subtitle}</p>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {TEACHER_TIERS.map((tier) => (
              <PriceCard key={tier} tier={tier} lang={lang} />
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-muted">{c.pricing.yearly}</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16">
        <h2 className="mb-8 text-center text-3xl font-bold">{c.faq.title}</h2>
        <div className="space-y-3">
          {c.faq.items.map(([q, a]) => (
            <details key={q} className="group rounded-2xl border border-line bg-sidebar p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                {q}
                <span className="text-muted transition group-open:rotate-45">＋</span>
              </summary>
              <p className="mt-3 text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-4 pb-16">
        <div className="mx-auto max-w-4xl rounded-3xl bg-gradient-to-br from-brand to-[#0b4f38] p-10 text-center text-white">
          <h2 className="text-3xl font-bold">{c.final.title}</h2>
          <p className="mt-2 opacity-90">{c.final.subtitle}</p>
          <Link href="/register" className="mt-6 inline-block rounded-xl bg-white px-6 py-3 font-semibold text-brand hover:bg-white/90">
            {c.final.cta}
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-8 text-sm text-muted">
          <span className="text-lg font-bold text-brand">{lang === "ar" ? "مجلس" : "Majlis"}</span>
          <span>{c.footer.tagline}</span>
          <div className="flex-1" />
          <Link href="/login" className="hover:text-fg">{c.footer.login}</Link>
          <Link href="/register" className="hover:text-fg">{c.footer.register}</Link>
          <Link href={other} className="hover:text-fg">{c.nav.lang}</Link>
          <span>© {new Date().getFullYear()} {lang === "ar" ? "مجلس" : "Majlis"} · {c.footer.rights}</span>
        </div>
      </footer>
    </div>
  );
}

function PriceCard({ tier, lang }: { tier: TeacherTier; lang: LandingLang }) {
  const c = landing[lang].pricing;
  const l = TIERS[tier];
  const popular = tier === "pro";
  const paid = (PAID_TIERS as readonly string[]).includes(tier);
  return (
    <div className={`flex flex-col gap-4 rounded-2xl border bg-bg p-6 ${popular ? "border-brand shadow-xl shadow-brand/10" : "border-line"}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold">{c.tiers[tier]}</h3>
        {popular && <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">{c.popular}</span>}
      </div>
      <div>
        <span className="text-4xl font-bold" dir="ltr">${l.priceUsd.monthly}</span>
        <span className="text-sm text-muted"> {c.monthly}</span>
        {paid && <div className="mt-1 text-xs text-brand">{c.trial}</div>}
      </div>
      <ul className="flex-1 space-y-2 text-sm">
        <li>✓ {c.servers(l.maxOwnedServers)}</li>
        <li>{l.canSell ? "✓" : "–"} {c.offers(l.maxOffersPerServer)}</li>
        <li>✓ {c.storage(l.storageGb)}</li>
        {l.canSell && <li>✓ {c.noCommission}</li>}
      </ul>
      <Link
        href="/register"
        className={`rounded-xl px-4 py-2.5 text-center font-semibold ${popular ? "bg-brand text-white hover:bg-brand-hover" : "border border-line hover:bg-surface-hover"}`}
      >
        {c.cta}
      </Link>
    </div>
  );
}
