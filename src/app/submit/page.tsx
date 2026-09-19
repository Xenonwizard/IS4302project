import { SubmitForm } from "@/components/submit/SubmitForm";

export const metadata = { title: "Submit my collectibles" };

export default function SubmitPage() {
  return (
    <div className="px-4 py-6 lg:px-6">
      <SubmitForm />
    </div>
  );
}
