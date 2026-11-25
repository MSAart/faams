import { IRDetailPage } from "@/components/ir/ir-detail-page";

export const dynamic = "force-dynamic";

export default async function IROperasionalDetailPage({
  params,
}: {
  params: Promise<{ irId: string }>;
}) {
  const { irId } = await params;
  return <IRDetailPage irId={irId} irType="operasional" />;
}
