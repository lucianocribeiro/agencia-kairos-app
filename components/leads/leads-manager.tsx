"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";

import { FieldInput } from "@/components/abm/field-input";
import { callApi } from "@/components/abm/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  FormField,
  InlineMessage,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  useToast,
} from "@/components/ui";
import { formatForDisplay, formatForInput, type FieldErrors, type RawValues } from "@/lib/abm/fields";
import { MAESTRO_MESSAGES } from "@/lib/abm/maestros";
import { cn } from "@/lib/cn";
import { LEAD_COLUMNS, LEAD_FIELDS, LEAD_MESSAGES, LEAD_ORIGENES, LEAD_STATUS, LEAD_TIPOS, validateLead, type LeadDTO } from "@/lib/leads/leads";

type Editing = { mode: "create" } | { mode: "edit"; lead: LeadDTO };
type Filtros = { tipo: string; status: string; origen: string };

const FIELD_BY_KEY = Object.fromEntries(LEAD_FIELDS.map((f) => [f.key, f]));
const SIGLA_RE = /^[A-Z]{2}$/;
const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const show = (lead: LeadDTO, key: string) => formatForDisplay(FIELD_BY_KEY[key], lead.values[key]);
const nombre = (lead: LeadDTO) => show(lead, "nombre") || "(sin nombre)";

const FILTROS: { key: keyof Filtros; label: string; options: readonly string[] }[] = [
  { key: "tipo", label: "Tipo", options: LEAD_TIPOS },
  { key: "status", label: "Status", options: LEAD_STATUS },
  { key: "origen", label: "Origen", options: LEAD_ORIGENES },
];

/**
 * Leads (CC-F4-06, solo Admin): lista con búsqueda y filtros por Tipo, Status y Origen; alta y
 * edición; «Pasar a cliente» (pide la Sigla) y «Eliminar», los dos con el diálogo de la app. Un lead
 * convertido se ve en gris, con link al cliente, y solo se puede eliminar. El servidor vuelve a
 * validar todo.
 */
export function LeadsManager({ leads }: { leads: LeadDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filtros, setFiltros] = useState<Filtros>({ tipo: "", status: "", origen: "" });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [raw, setRaw] = useState<RawValues>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [eliminar, setEliminar] = useState<LeadDTO | null>(null);
  const [convertir, setConvertir] = useState<LeadDTO | null>(null);
  const [sigla, setSigla] = useState("");
  const [dialogErrors, setDialogErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const siglaRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const q = normalize(query.trim());
    return leads
      .filter((l) => (Object.keys(filtros) as (keyof Filtros)[]).every((k) => !filtros[k] || l.values[k] === filtros[k]))
      .filter((l) => !q || LEAD_COLUMNS.some((c) => normalize(show(l, c)).includes(q)))
      .sort((a, b) => collator.compare(nombre(a), nombre(b)));
  }, [leads, filtros, query]);

  function open(target: Editing) {
    setEditing(target);
    setErrors({});
    setFormError(null);
    const initial: RawValues = {};
    for (const f of LEAD_FIELDS) initial[f.key] = target.mode === "edit" ? formatForInput(f, target.lead.values[f.key]) : "";
    setRaw(initial);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function close() {
    setEditing(null);
    setRaw({});
    setErrors({});
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const local = validateLead(raw);
    if (Object.keys(local.errors).length > 0) {
      setErrors(local.errors);
      setFormError(LEAD_MESSAGES.validacion);
      return;
    }
    setSaving(true);
    const body = Object.fromEntries(LEAD_FIELDS.map((f) => [f.key, raw[f.key] ?? ""]));
    const res = editing.mode === "create" ? await callApi("POST", "/api/admin/leads", body) : await callApi("PATCH", `/api/admin/leads/${editing.lead.id}`, body);
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      setFormError(res.error ?? "Ocurrió un error. Probá de nuevo.");
      return;
    }
    toast.success(editing.mode === "create" ? "Lead creado." : "Cambios guardados.");
    close();
    router.refresh();
  }

  function askConvertir(lead: LeadDTO) {
    setSigla("");
    setDialogErrors({});
    setConvertir(lead);
  }

  async function doConvertir() {
    if (!convertir) return;
    const value = sigla.trim().toUpperCase();
    if (!value) return setDialogErrors({ sigla: LEAD_MESSAGES.siglaRequerida });
    if (!SIGLA_RE.test(value)) return setDialogErrors({ sigla: MAESTRO_MESSAGES.clienteSiglaFormato });
    setBusy(true);
    const res = await callApi("POST", `/api/admin/leads/${convertir.id}/convertir`, { sigla: value });
    setBusy(false);
    if (!res.ok) {
      const fe = res.fieldErrors ?? {};
      // Sin error de campo, el mensaje va arriba del diálogo.
      setDialogErrors(fe.sigla || fe.nombre || fe.general ? fe : { general: res.error ?? "Ocurrió un error. Probá de nuevo." });
      return;
    }
    toast.success("El lead pasó a Clientes.");
    setConvertir(null);
    if (editing?.mode === "edit" && editing.lead.id === convertir.id) close();
    router.refresh();
  }

  async function doEliminar() {
    if (!eliminar) return;
    setBusy(true);
    const res = await callApi("DELETE", `/api/admin/leads/${eliminar.id}`);
    setBusy(false);
    const target = eliminar;
    setEliminar(null);
    if (!res.ok) {
      toast.error(res.error ?? "No se pudo eliminar.");
      return;
    }
    toast.success("Lead eliminado.");
    if (editing?.mode === "edit" && editing.lead.id === target.id) close();
    router.refresh();
  }

  const title = editing?.mode === "edit" ? nombre(editing.lead) : "Nuevo lead";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Leads</h1>
        {!editing && (
          <Button onClick={() => open({ mode: "create" })}>
            <Plus aria-hidden="true" className="size-4" />
            Nuevo lead
          </Button>
        )}
      </header>

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate className="flex flex-col gap-5">
              {formError && <InlineMessage tone="danger">{formError}</InlineMessage>}
              <div className="grid gap-4 md:grid-cols-2">
                {LEAD_FIELDS.map((f) => (
                  <div key={f.key} className={f.kind === "multiline" ? "md:col-span-2" : undefined}>
                    <FieldInput spec={f} value={raw[f.key]} onChange={(v) => setRaw((prev) => ({ ...prev, [f.key]: v }))} error={errors[f.key]} disabled={saving} />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar"}
                </Button>
                <Button variant="secondary" onClick={close} disabled={saving}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="relative flex-1">
            <span className="sr-only">Buscar</span>
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar…" className="pl-9" />
          </label>
          {FILTROS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 sm:w-40">
              <span className="text-xs text-muted">{f.label}</span>
              <Select
                aria-label={`Filtrar por ${f.label}`}
                value={filtros[f.key]}
                onChange={(e) => setFiltros({ ...filtros, [f.key]: e.target.value })}
                placeholder="Todos"
                options={f.options.map((o) => ({ value: o, label: o }))}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-muted" aria-live="polite">
          {rows.length === leads.length ? `${leads.length} leads` : `${rows.length} de ${leads.length} leads`}
        </p>
        <Table>
          <TableHead>
            <tr>
              {LEAD_COLUMNS.map((c) => (
                <TableHeaderCell key={c}>{FIELD_BY_KEY[c].label}</TableHeaderCell>
              ))}
              <TableHeaderCell>
                <span className="sr-only">Acciones</span>
              </TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={LEAD_COLUMNS.length + 1}>{leads.length === 0 ? "Todavía no hay leads." : "No hay resultados con esos filtros."}</TableEmpty>
            ) : (
              rows.map((l) => (
                <TableRow
                  key={l.id}
                  data-convertido={l.convertido || undefined}
                  className={cn(l.convertido ? "bg-surface/40 text-muted" : "cursor-pointer")}
                  onClick={l.convertido ? undefined : () => open({ mode: "edit", lead: l })}
                >
                  {LEAD_COLUMNS.map((c) => (
                    <TableCell key={c} className="whitespace-nowrap">
                      {show(l, c) || <span className="text-muted">—</span>}
                      {c === "nombre" && l.convertido && (
                        <span className="mt-0.5 block text-xs">
                          {l.cliente ? (
                            <Link href="/maestros/clientes" className="underline underline-offset-2 hover:text-text" onClick={(e) => e.stopPropagation()}>
                              Cliente: {l.cliente.nombre}
                            </Link>
                          ) : (
                            "Pasó a cliente"
                          )}
                        </span>
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {!l.convertido && (
                      <>
                        <Button variant="ghost" size="sm" aria-label={`Editar ${nombre(l)}`} onClick={() => open({ mode: "edit", lead: l })}>
                          Editar
                        </Button>
                        <Button variant="ghost" size="sm" aria-label={`Pasar a cliente ${nombre(l)}`} onClick={() => askConvertir(l)}>
                          Pasar a cliente
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="sm" aria-label={`Eliminar ${nombre(l)}`} onClick={() => setEliminar(l)}>
                      Eliminar
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={convertir !== null}
        title={convertir ? `Pasar «${nombre(convertir)}» a cliente` : ""}
        confirmLabel="Pasar a cliente"
        busy={busy}
        busyLabel="Pasando…"
        destructive={false}
        initialFocus={siglaRef}
        onConfirm={doConvertir}
        onCancel={() => setConvertir(null)}
      >
        <p>{LEAD_MESSAGES.convertirConfirmacion}</p>
        <div className="mt-4 flex flex-col gap-3 text-left">
          {dialogErrors.general && <InlineMessage tone="danger">{dialogErrors.general}</InlineMessage>}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text">Nombre</span>
            <p className="min-h-10 rounded-md border border-line bg-bg px-3 py-2 text-sm text-text">{convertir ? nombre(convertir) : ""}</p>
            <p className="text-xs text-muted">Se copia del lead, igual que Contacto, Teléfono, Mail y Comentarios.</p>
            {dialogErrors.nombre && (
              <p role="alert" className="text-xs text-danger">
                {dialogErrors.nombre}
              </p>
            )}
          </div>
          <FormField label="Sigla" required error={dialogErrors.sigla} hint="2 letras. Única.">
            <Input
              ref={siglaRef}
              value={sigla}
              maxLength={2}
              autoComplete="off"
              className="uppercase"
              onChange={(e) => setSigla(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void doConvertir();
                }
              }}
              disabled={busy}
            />
          </FormField>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={eliminar !== null}
        title={eliminar ? `Eliminar «${nombre(eliminar)}»` : ""}
        confirmLabel="Sí, eliminar"
        busy={busy}
        busyLabel="Eliminando…"
        destructive={false}
        onConfirm={doEliminar}
        onCancel={() => setEliminar(null)}
      >
        {LEAD_MESSAGES.eliminarConfirmacion}
      </ConfirmDialog>
    </div>
  );
}
