import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type MessageTone = "success" | "danger" | "info";

const TONES: Record<MessageTone, { className: string; Icon: typeof Info }> = {
  success: { className: "border-success/40 bg-success/10 text-success", Icon: CircleCheck },
  danger: { className: "border-danger/40 bg-danger/10 text-danger", Icon: CircleAlert },
  info: { className: "border-line bg-card text-text", Icon: Info },
};

export interface InlineMessageProps {
  tone?: MessageTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Mensaje en línea (p. ej. arriba de un formulario). Los errores se anuncian como alert. */
export function InlineMessage({ tone = "info", title, children, className }: InlineMessageProps) {
  const { className: toneClass, Icon } = TONES[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-md border px-4 py-3 text-sm", toneClass, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? "text-text" : undefined}>{children}</div>}
      </div>
    </div>
  );
}

export { TONES as MESSAGE_TONES };
