import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { RipFlow } from "@/components/packs/RipFlow";
import { PACKS, getPack } from "@/lib/catalog";

export function generateStaticParams() {
  return PACKS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pack = getPack(slug);
  return { title: pack ? pack.name : "Pack not found" };
}

export default async function PackPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pack = getPack(slug);
  if (!pack) notFound();

  return (
    <div className="px-4 py-5 lg:px-6">
      <Link
        href="/packs"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted transition hover:text-white"
      >
        <ChevronLeft size={15} />
        All packs
      </Link>
      <h1 className="text-[24px] font-bold leading-tight">{pack.name}</h1>
      <p className="mt-1.5 mb-6 text-[14px] text-muted">{pack.tagline}</p>
      <RipFlow pack={pack} />
    </div>
  );
}
