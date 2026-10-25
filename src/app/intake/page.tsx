import { IntakeSimulator } from "@/components/chain/IntakeSimulator";

// Keep the demo tab free from the parent product's title template.
export const metadata = { title: { absolute: "Card processing simulator" } };

export default function IntakePage() {
  return <IntakeSimulator />;
}
