import { Phone } from "lucide-react";
import { toWhatsAppDigits } from "@/lib/outbox";
import { formatPhone } from "@/lib/utils";

/**
 * A phone number that opens WhatsApp to that person. A number that doesn't
 * resolve is shown as it was saved, unlinked — a link without the country code
 * opens a chat with a stranger abroad.
 */
export function PhoneLink({ phone }: { phone: string }) {
  const digits = toWhatsAppDigits(phone);
  const label = (
    <>
      <Phone className="h-3 w-3" />
      {formatPhone(phone)}
    </>
  );
  if (!digits) return <span className="inline-flex items-center gap-1">{label}</span>;
  return (
    <a
      href={`https://wa.me/${digits}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-10 items-center gap-1 py-1 hover:text-foreground hover:underline"
    >
      {label}
    </a>
  );
}
