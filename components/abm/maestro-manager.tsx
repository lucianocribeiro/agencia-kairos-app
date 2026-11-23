"use client";

import { CloudDownload, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, InlineMessage, useToast } from "@/components/ui";
import { editableFields, formatForDisplay, formatForInput, type FieldErrors, type RawValues } from "@/lib/abm/fields";
import { MAESTRO_SPECS, reglaProtegida, SIN_ESTADO, sociosSumWarning, validateMaestro, type MaestroSlug } from "@/lib/abm/maestros";
import type { AbmData, RecordDTO } from "@/lib/abm/types";
import { isValidCuit } from "@/lib/cuit";
import { PADRON_MESSAGES, type PadronStatus } from "@/lib/padron/padron";

import { callApi } from "./api";
import { FieldInput } from "./field-input";
import { RecordTable, type Column, type Filter } from "./record-table";

/** Bloqueados mientras hay una consulta al padrón pendiente: la CUIT y los tres campos que llena. */
const PADRON_BLOQUEADOS = new Set(["cuit", "razonSocial", "domicilioComercial", "condicionIva"]);

type Editing = { mode: "create" } | { mode: "edit"; record: RecordDTO };

/** Campos del formulario de Clientes que llena «Traer datos de ARCA», con la clave de la respuesta. */
const PADRON_CAMPOS = [
  ["razonSocial", "razonSocial"],
  ["domicilioComercial", "domicilio"],
  ["condicionIva", "condicionIva"],
] as const;

/**
 * ABM de un Maestro, armado a partir de su spec (lib/abm/maestros.ts):
 * lista con búsqueda/filtro por Estado, alta, edición y borrado (si la tabla
 * lo permite y el registro no tiene referencias). El servidor vuelve a validar todo.
 */
export function MaestroManager({ slug, data, padron }: { slug: MaestroSlug; data: AbmData; padron?: PadronStatus }) {
  const spec = MAESTRO_SPECS[slug];
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [raw, setRaw] = useState<RawValues>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Padrón de ARCA (F5-05): solo completa el formulario; nada se guarda hasta «Guardar».
  const [consultando, setConsultando] = useState(false);
  const [antes, setAntes] = useState<Record<string, string>>({});
  const [avisos, setAvisos] = useState<string[]>([]);
  const [padronError, setPadronError] = useState<string | null>(null);
  const [padronOk, setPadronOk] = useState<string | null>(null);

  // CX-F5-08 F-02: cada consulta lleva la sesión de edición y la CUIT; abrir, cerrar o cambiar de registro la aborta.
  const sessionRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const cuitRef = useRef("");
  useEffect(() => {
    cuitRef.current = typeof raw.cuit === "string" ? raw.cuit : "";
  }, [raw.cuit]);
  useEffect(() => () => abortRef.current?.abort(), []);

  function resetPadron() {
    sessionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setConsultando(false);
    setAntes({});
    setAvisos([]);
    setPadronError(null);
    setPadronOk(null);
  }

  const fieldByKey = Object.fromEntries(spec.fields.map((f) => [f.key, f]));
  const display = (r: RecordDTO, key: string) => {
    const f = fieldByKey[key];
    const v = r.values[key];
    if (key === spec.estadoKey && (v === null || v === undefined || v === "")) return SIN_ESTADO;
    return f ? formatForDisplay(f, v, data.labels[key]) : String(v ?? "");
  };

  const columns: Column[] = spec.columns.map((key) => ({
    key,
    label: fieldByKey[key]?.label ?? key,
    text: (r) => display(r, key),
    numeric: ["number", "integer", "percent"].includes(fieldByKey[key]?.kind ?? ""),
  }));

  const filters: Filter[] = spec.estadoKey
    ? [
        {
          key: spec.estadoKey,
          label: "Estado",
          options: [
            ...(fieldByKey[spec.estadoKey]?.options ?? []),
            ...(data.records.some((r) => !r.values[spec.estadoKey!]) ? [SIN_ESTADO] : []),
          ],
          value: (r) => display(r, spec.estadoKey!),
          ...(spec.estadoDefault ? { defaultValue: spec.estadoDefault } : {}),
        },
      ]
    : [];

  const warning = slug === "socios" ? sociosSumWarning(data.records.map((r) => r.values.porcentajeRetiros as number | null)) : null;

  function open(target: Editing) {
    setEditing(target);
    setErrors({});
    setFormError(null);
    setConfirmDelete(false);
    resetPadron();
    const initial: RawValues = {};
    for (const f of spec.fields) initial[f.key] = target.mode === "edit" ? formatForInput(f, target.record.values[f.key]) : f.kind === "checkbox" ? false : f.kind === "link" ? [] : "";
    setRaw(initial);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function close() {
    setEditing(null);
    setRaw({});
    setErrors({});
    setFormError(null);
    resetPadron();
  }

  /** «Traer datos de ARCA»: completa Razón social, Domicilio comercial y Condición IVA en el formulario (sin guardar). */
  async function traerDeArca() {
    const cuit = typeof raw.cuit === "string" ? raw.cuit : "";
    if (!padron?.configured || !isValidCuit(cuit) || consultando) return;
    const session = sessionRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setConsultando(true);
    setPadronError(null);
    setPadronOk(null);
    setAvisos([]);
    const res = await callApi("POST", "/api/admin/clientes/padron", { cuit }, controller.signal);
    // Respuesta vieja (otra sesión de edición, consulta abortada o la CUIT cambió): se ignora en silencio.
    if (controller.signal.aborted || session !== sessionRef.current || cuitRef.current !== cuit) {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setConsultando(false);
      }
      return;
    }
    abortRef.current = null;
    setConsultando(false);
    if (!res.ok) {
      setPadronError(res.error ?? "Ocurrió un error. Probá de nuevo.");
      return;
    }
    const nuevos: Record<string, string> = {};
    const previos: Record<string, string> = {};
    for (const [campo, clave] of PADRON_CAMPOS) {
      const valor = res.data[clave];
      if (typeof valor !== "string" || !valor) continue;
      const actual = typeof raw[campo] === "string" ? (raw[campo] as string) : "";
      if (valor === actual) continue;
      nuevos[campo] = valor;
      previos[campo] = antes[campo] ?? actual;
    }
    setRaw((prev) => ({ ...prev, ...nuevos }));
    setAntes((prev) => ({ ...prev, ...previos }));
    setAvisos(Array.isArray(res.data.avisos) ? res.data.avisos.filter((a): a is string => typeof a === "string") : []);
    setPadronOk(Object.keys(nuevos).length > 0 ? PADRON_MESSAGES.completados : PADRON_MESSAGES.sinCambios);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    // Mismas reglas que el servidor, para avisar antes de enviar.
    const local = validateMaestro(spec, raw, editing.mode);
    if (Object.keys(local.errors).length > 0) {
      setErrors(local.errors);
      setFormError("Revisá los campos marcados.");
      return;
    }
    setSaving(true);
    const body = Object.fromEntries(editableFields(spec.fields, editing.mode).map((f) => [f.key, raw[f.key]]));
    const res =
      editing.mode === "create"
        ? await callApi("POST", `/api/admin/maestros/${slug}`, body)
        : await callApi("PATCH", `/api/admin/maestros/${slug}/${editing.record.id}`, body);
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      setFormError(res.error ?? "Ocurrió un error. Probá de nuevo.");
      return;
    }
    toast.success(editing.mode === "create" ? "Registro creado." : "Cambios guardados.");
    close();
    router.refresh();
  }

  /** Antes de confirmar: con referencias se muestra el motivo (sin diálogo); sin referencias, el diálogo. */
  async function askDelete() {
    if (editing?.mode !== "edit") return;
    setSaving(true);
    const res = await callApi("GET", `/api/admin/maestros/${slug}/${editing.record.id}/referencias`);
    setSaving(false);
    if (!res.ok) return setFormError(res.error ?? "No se pudo borrar.");
    if (res.data.blocked === true) return setFormError(typeof res.data.message === "string" ? res.data.message : "No se puede borrar.");
    setFormError(null);
    setConfirmDelete(true);
  }

  async function remove() {
    if (editing?.mode !== "edit") return;
    setSaving(true);
    const res = await callApi("DELETE", `/api/admin/maestros/${slug}/${editing.record.id}`);
    setSaving(false);
    setConfirmDelete(false);
    if (!res.ok) {
      setFormError(res.error ?? "No se pudo borrar.");
      return;
    }
    toast.success("Registro borrado.");
    close();
    router.refresh();
  }

  const title = editing?.mode === "edit" ? display(editing.record, spec.primaryKey) || "Editar" : spec.newLabel;
  const protegido = editing?.mode === "edit" ? reglaProtegida(spec, editing.record.values) : null;
  const bloqueado = editing?.mode === "edit" && (editing.record.referenceCount ?? 0) > 0 ? (spec.bloqueadoConReferencias ?? null) : null;
  const canDelete = spec.deletable && editing?.mode === "edit" && !protegido;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-strong">{spec.title}</h1>
        {!editing && (
          <Button onClick={() => open({ mode: "create" })}>
            <Plus aria-hidden="true" className="size-4" />
            {spec.newLabel}
          </Button>
        )}
      </header>

      {warning && <InlineMessage tone="info">{warning}</InlineMessage>}

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate className="flex flex-col gap-5">
              {formError && <InlineMessage tone="danger">{formError}</InlineMessage>}
              {protegido && <InlineMessage tone="info">{protegido.mensaje}</InlineMessage>}
              {bloqueado && <InlineMessage tone="info">{bloqueado.mensaje}</InlineMessage>}
              {padronError && <InlineMessage tone="danger">{padronError}</InlineMessage>}
              {avisos.length > 0 && (
                <InlineMessage tone="info" title="Avisos de ARCA">
                  <ul className="flex list-disc flex-col gap-1 pl-4">
                    {avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </InlineMessage>
              )}
              {padronOk && <InlineMessage tone="success">{padronOk}</InlineMessage>}
              <div className="grid gap-4 md:grid-cols-2">
                {spec.fields
                  .filter((f) => !f.hideInForm && (f.kind !== "readonly" || editing.mode === "edit"))
                  .map((f) => (
                    <div key={f.key} className={f.kind === "multiline" || (f.kind === "link" && f.multiple) ? "md:col-span-2" : undefined}>
                      <FieldInput
                        spec={f}
                        value={raw[f.key]}
                        onChange={(v) => setRaw((prev) => ({ ...prev, [f.key]: v }))}
                        error={errors[f.key]}
                        options={data.options[f.key]}
                        labels={data.labels[f.key]}
                        disabled={saving || (consultando && PADRON_BLOQUEADOS.has(f.key)) || (editing.mode === "edit" && f.lockedOnEdit) || !!protegido?.keys.includes(f.key) || !!bloqueado?.keys.includes(f.key)}
                        display={editing.mode === "edit" ? display(editing.record, f.key) : undefined}
                      />
                      {f.key in antes && (
                        <p className="mt-1 text-xs text-muted" data-antes={f.key}>
                          Antes: {antes[f.key] || "—"}
                        </p>
                      )}
                      {padron && f.key === "cuit" && <PadronButton padron={padron} cuit={raw.cuit} consultando={consultando} disabled={saving} onClick={traerDeArca} />}
                    </div>
                  ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={saving || consultando}>
                  {saving ? "Guardando…" : "Guardar"}
                </Button>
                <Button variant="secondary" onClick={close} disabled={saving}>
                  Cancelar
                </Button>
                {canDelete && (
                  <Button variant="ghost" size="sm" onClick={askDelete} disabled={saving} className="ml-auto">
                    Borrar
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDelete && editing?.mode === "edit"}
        title={`¿Borrar ${editing?.mode === "edit" ? display(editing.record, spec.primaryKey) || "este registro" : "este registro"}?`}
        confirmLabel="Sí, borrar"
        busy={saving}
        busyLabel="Borrando…"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      >
        No se puede deshacer.
      </ConfirmDialog>

      <RecordTable
        records={data.records}
        columns={columns}
        filters={filters}
        sortBy={(r) => (spec.primaryNumeric ? Number(r.values[spec.primaryKey] ?? 0) : display(r, spec.primaryKey))}
        onEdit={(r) => open({ mode: "edit", record: r })}
        rowLabel={(r) => display(r, spec.primaryKey)}
      />
    </div>
  );
}

/** Botón «Traer datos de ARCA» junto al CUIT: habilitado solo con una CUIT válida y el padrón configurado. */
function PadronButton({ padron, cuit, consultando, disabled, onClick }: { padron: PadronStatus; cuit: unknown; consultando: boolean; disabled: boolean; onClick: () => void }) {
  const cuitOk = typeof cuit === "string" && isValidCuit(cuit);
  const motivo = !padron.configured ? padron.motivo : !cuitOk ? PADRON_MESSAGES.cuitInvalida : null;
  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <Button variant="secondary" size="sm" onClick={onClick} disabled={disabled || consultando || !padron.configured || !cuitOk}>
        <CloudDownload aria-hidden="true" className="size-4" />
        {consultando ? PADRON_MESSAGES.consultando : PADRON_MESSAGES.boton}
      </Button>
      {motivo && <p className="text-xs text-muted">{motivo}</p>}
    </div>
  );
}
